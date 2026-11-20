import { generateText } from "ai";
import db from "@/lib/db";
import { resumeDetailInclude } from "@/lib/jobs/resumeDetailInclude";
import {
  UNANALYZED_MARKER,
  unmatchedJobsWhere,
} from "@/lib/jobs/unmatched";
import { automationLogger } from "@/lib/automation-logger";
import { startAiCall } from "@/lib/aiUsage/tracker";
import { log } from "@/lib/telemetry";
import {
  getModel,
  parseJobMatch,
  JOB_MATCH_SYSTEM_PROMPT,
  buildJobMatchPrompt,
  preprocessResume,
  preprocessJob,
} from "@/lib/ai";
import { resolveDealBreakers, withDealBreakers } from "@/lib/ai/dealBreakers";
import {
  aiMatchConfig,
  type Automation,
  type FunnelStage,
} from "@/models/automation.model";
import type { AiSettings } from "@/models/userSettings.model";
import type { ResumeWithSections, RunnerResult } from "./types";
import { finalizeRun } from "./finalize";
import {
  getAutomationMatchLimit,
  getDefaultModelForProvider,
  getUserAiSettings,
} from "./aiSettings";
import {
  getUserDealBreakers,
  withdrawForDealBreakers,
} from "@/lib/jobs/dealBreakers";

const LABEL = "[AI Matching]";

// Which surface wrote a match, kept in matchData like the other surfaces.
export const AI_MATCH_SURFACE = "ai-match-automation";

const CANDIDATE_PAGE = 50;

const JOB_SELECT = {
  id: true,
  description: true,
  workplaceType: true,
  createdAt: true,
  automationId: true,
  resumeId: true,
  matchData: true,
  JobTitle: { select: { label: true } },
  Company: { select: { label: true } },
  Location: { select: { label: true } },
  automation: { select: { resumeId: true } },
} as const;

type Candidate = {
  id: string;
  description: string;
  workplaceType: string | null;
  createdAt: Date;
  automationId: string | null;
  resumeId: string | null;
  matchData: string | null;
  JobTitle: { label: string };
  Company: { label: string };
  Location: { label: string } | null;
  automation: { resumeId: string } | null;
};

function isAiUnavailable(message: string): boolean {
  return (
    message.includes("ECONNREFUSED") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("Failed to fetch") ||
    message.includes("ENOTFOUND")
  );
}

export async function runAiMatchRun(
  automation: Automation,
  runId: string,
  automationResume: ResumeWithSections,
  signal?: AbortSignal,
): Promise<RunnerResult> {
  const zero = {
    jobsSearched: 0,
    jobsDeduplicated: 0,
    jobsProcessed: 0,
    jobsMatched: 0,
    jobsSaved: 0,
  };

  try {
    let cfg;
    try {
      cfg = aiMatchConfig(
        JSON.parse(automation.sourceConfig ?? "{}")?.["ai-match"],
      );
    } catch {
      cfg = aiMatchConfig(null);
    }

    if (!cfg.includeDiscovered && !cfg.includeTracked) {
      automationLogger.log(automation.id, "error", `${LABEL} No kind of job is selected to score`);
      automationLogger.endRun(automation.id);
      return await finalizeRun(runId, {
        status: "failed",
        errorMessage: "no_match_scope",
        ...zero,
      });
    }

    const where = unmatchedJobsWhere(automation.userId, cfg);
    const totalUnmatched = await db.job.count({ where });
    const scope = [
      cfg.includeDiscovered && "listings saved without AI analysis",
      cfg.includeTracked && "jobs in My Jobs with no score",
    ]
      .filter(Boolean)
      .join(" and ");
    automationLogger.log(
      automation.id,
      "info",
      `${LABEL} ${totalUnmatched} unmatched job(s) found (${scope})`,
      { jobsSearched: totalUnmatched },
    );

    const buildFunnel = (selected: number, scored: number, strong: number) =>
      JSON.stringify([
        { key: "unmatched", label: "Unmatched", count: totalUnmatched },
        { key: "selected", label: "Selected", count: selected },
        { key: "scored", label: "Scored", count: scored },
        { key: "strong", label: "Strong match", count: strong },
      ] satisfies FunnelStage[]);

    if (totalUnmatched === 0) {
      automationLogger.log(automation.id, "success", `${LABEL} Nothing to score. Run complete.`);
      automationLogger.endRun(automation.id);
      return await finalizeRun(runId, {
        status: "completed",
        funnelStats: buildFunnel(0, 0, 0),
        ...zero,
      });
    }

    // Resumes are loaded once each. A job's own resume that has since been
    // deleted falls back to this automation's.
    const resumes = new Map<string, Promise<ResumeWithSections | null>>();
    resumes.set(automationResume.id, Promise.resolve(automationResume));
    const loadResume = (id: string) => {
      if (!resumes.has(id)) {
        resumes.set(
          id,
          db.resume
            .findFirst({
              where: { id, profile: { userId: automation.userId } },
              include: resumeDetailInclude,
            })
            .then((r) => (r as ResumeWithSections | null) ?? null)
            .catch(() => null),
        );
      }
      return resumes.get(id)!;
    };
    const resumeTexts = new Map<string, Promise<string | null>>();
    const resumeText = (resume: ResumeWithSections) => {
      if (!resumeTexts.has(resume.id)) {
        resumeTexts.set(
          resume.id,
          preprocessResume(resume as never).then((r) =>
            r.success ? r.data.normalizedText : null,
          ),
        );
      }
      return resumeTexts.get(resume.id)!;
    };
    const resumeFor = async (job: Candidate) => {
      if (cfg.resumeSource === "job") {
        const own = job.automation?.resumeId ?? job.resumeId;
        if (own && own !== automationResume.id) {
          const resume = await loadResume(own);
          if (resume) return resume;
        }
      }
      return automationResume;
    };

    // Pick the jobs: newest (or oldest) first, skipping any whose posting is
    // too thin to score so they never take a place from a scorable one.
    type Selected = { job: Candidate; jobText: string; resume: ResumeWithSections; resumeText: string };
    const selected: Selected[] = [];
    let unreadable = 0;
    let noResume = 0;
    for (let skip = 0; selected.length < cfg.maxJobs; skip += CANDIDATE_PAGE) {
      if (signal?.aborted) break;
      const page = (await db.job.findMany({
        where,
        select: JOB_SELECT,
        orderBy: [
          { createdAt: cfg.newestFirst ? "desc" : "asc" },
          { id: "asc" },
        ],
        skip,
        take: CANDIDATE_PAGE,
      })) as Candidate[];
      if (page.length === 0) break;
      for (const job of page) {
        if (selected.length >= cfg.maxJobs) break;
        const jobPre = await preprocessJob(job as never);
        if (!jobPre.success) {
          unreadable++;
          continue;
        }
        const resume = await resumeFor(job);
        const text = await resumeText(resume);
        if (!text) {
          noResume++;
          continue;
        }
        selected.push({ job, jobText: jobPre.data.normalizedText, resume, resumeText: text });
      }
      if (page.length < CANDIDATE_PAGE) break;
    }

    if (unreadable > 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${LABEL} Skipped ${unreadable} job(s) whose description is too short to score`,
      );
    }
    if (noResume > 0) {
      automationLogger.log(
        automation.id,
        "warning",
        `${LABEL} Skipped ${noResume} job(s): their resume has too little content to match against`,
      );
    }

    const aiSettings: AiSettings = await getUserAiSettings(automation.userId);
    const modelName =
      aiSettings.model || getDefaultModelForProvider(aiSettings.provider);
    const model = await getModel(aiSettings.provider, modelName, automation.userId);
    const limit = getAutomationMatchLimit(aiSettings.provider);
    const dealBreakerSettings = await getUserDealBreakers(automation.userId);
    const system = withDealBreakers(
      JOB_MATCH_SYSTEM_PROMPT,
      dealBreakerSettings.items,
    );

    automationLogger.log(
      automation.id,
      "info",
      `${LABEL} Scoring ${selected.length} job(s), ${cfg.newestFirst ? "newest" : "oldest"} first, with ${aiSettings.provider} (${modelName})...`,
    );

    let scored = 0;
    let strong = 0;
    let dealBroken = 0;
    let withdrawnCount = 0;
    let failed = 0;
    let alreadyScored = 0;
    let aiError: string | null = null;

    const scoreOne = async ({ job, jobText, resume, resumeText: rText }: Selected) => {
      if (signal?.aborted || aiError) return;
      const title = `${job.JobTitle.label} at ${job.Company.label}`;

      const tracker = startAiCall({
        userId: automation.userId,
        feature: "automations",
        provider: aiSettings.provider,
        model: modelName,
      });
      let text: string;
      try {
        const generated = await generateText({
          model,
          instructions: system,
          prompt: buildJobMatchPrompt(rText, jobText),
          temperature: 0.3,
          abortSignal: signal,
        });
        void tracker.finish({
          usage: generated.usage,
          finishReason: generated.finishReason,
        });
        text = generated.text;
      } catch (error) {
        void tracker.finish({ error, abortedBy: signal });
        if (signal?.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        if (isAiUnavailable(message)) {
          if (!aiError) {
            aiError = `AI provider (${aiSettings.provider}) is not available.`;
            automationLogger.log(automation.id, "error", `${LABEL} ${aiError} Stopping.`);
          }
          return;
        }
        failed++;
        automationLogger.log(automation.id, "warning", `${LABEL} Could not score ${title}: ${message}`);
        return;
      }
      if (signal?.aborted) return;

      const { scores, body, dealBreakerHits } = parseJobMatch(text);
      if (!scores) {
        failed++;
        automationLogger.log(
          automation.id,
          "warning",
          `${LABEL} Could not score ${title}: the AI reply had no score`,
        );
        return;
      }

      let previous: Record<string, unknown> = {};
      try {
        previous = JSON.parse(job.matchData ?? "{}");
      } catch {}
      delete previous.dealBreakers;
      const dealBreakers = resolveDealBreakers(
        dealBreakerSettings.items,
        dealBreakerHits,
      );
      const matchData = JSON.stringify({
        ...previous,
        ...(dealBreakers ? { dealBreakers } : {}),
        ...scores,
        body,
        resumeId: resume.id,
        resumeTitle: resume.title,
        matchedAt: new Date().toISOString(),
        provider: aiSettings.provider,
        model: modelName,
        surface: AI_MATCH_SURFACE,
        analyzed: true,
      });

      // Only if it is still unmatched: the user may have scored it by hand
      // while this run was working.
      const { count } = await db.job.updateMany({
        where: {
          id: job.id,
          userId: automation.userId,
          OR: [{ matchScore: null }, { matchData: { contains: UNANALYZED_MARKER } }],
        },
        data: { matchScore: scores.matchScore, matchData },
      });
      if (count === 0) {
        alreadyScored++;
        return;
      }

      scored++;
      const found = dealBreakers?.found ?? [];
      const withdrawn = await withdrawForDealBreakers({
        jobId: job.id,
        userId: automation.userId,
        dealBreakers,
        settings: dealBreakerSettings,
      });
      if (found.length > 0) dealBroken++;
      if (withdrawn) withdrawnCount++;
      const isStrong =
        scores.matchScore >= automation.matchThreshold && found.length === 0;
      if (isStrong) strong++;
      const dealNote =
        found.length > 0
          ? ` — deal breaker: ${found.join(", ")}${withdrawn ? " (moved to Withdrawn)" : ""}`
          : "";
      automationLogger.log(
        automation.id,
        isStrong ? "success" : found.length > 0 ? "warning" : "info",
        `${LABEL} Scored ${scored}/${selected.length}: ${title} — ${scores.matchScore}%${dealNote}`,
        { score: scores.matchScore, threshold: automation.matchThreshold },
      );
    };

    await Promise.allSettled(selected.map((s) => limit(() => scoreOne(s))));

    if (signal?.aborted) {
      automationLogger.log(automation.id, "warning", `${LABEL} Run aborted by user`);
    }
    if (alreadyScored > 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${LABEL} ${alreadyScored} job(s) were scored elsewhere during the run and left as they were`,
      );
    }
    if (dealBroken > 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${LABEL} ${dealBroken} job(s) hit a deal breaker${withdrawnCount > 0 ? `; ${withdrawnCount} moved to Withdrawn` : ""}`,
      );
    }
    const left = Math.max(0, totalUnmatched - scored - alreadyScored);
    automationLogger.log(
      automation.id,
      "success",
      `${LABEL} Scored ${scored} job(s), ${strong} at or above ${automation.matchThreshold}%. ${left} unmatched job(s) left.`,
    );
    automationLogger.endRun(automation.id);

    const counts = {
      jobsSearched: totalUnmatched,
      jobsDeduplicated: selected.length,
      jobsProcessed: scored,
      jobsMatched: strong,
      jobsSaved: 0,
      funnelStats: buildFunnel(selected.length, scored, strong),
      aiMatchFailed: failed,
    };

    if (signal?.aborted) {
      return await finalizeRun(runId, { status: "cancelled", ...counts });
    }
    if (aiError && scored === 0) {
      return await finalizeRun(runId, { status: "failed", errorMessage: aiError, ...counts });
    }
    const problems = [
      aiError,
      failed > 0 ? `${failed} job(s) could not be scored` : null,
    ].filter(Boolean);
    return await finalizeRun(runId, {
      status: problems.length > 0 ? "completed_with_errors" : "completed",
      errorMessage: problems.join("; ") || undefined,
      aiError: aiError ?? undefined,
      ...counts,
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      automationLogger.log(automation.id, "warning", `${LABEL} Run aborted by user`);
      automationLogger.endRun(automation.id);
      return await finalizeRun(runId, { status: "cancelled", ...zero });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    automationLogger.log(automation.id, "error", `${LABEL} Run failed: ${message}`);
    automationLogger.endRun(automation.id);
    log.error("[AI Matching] Run failed", {
      "automation.id": automation.id,
      "run.id": runId,
      error: message,
    });
    return await finalizeRun(runId, { status: "failed", errorMessage: message, ...zero });
  }
}
