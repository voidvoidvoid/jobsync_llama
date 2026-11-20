import type {
  Automation,
  FunnelStage,
} from "@/models/automation.model";
import type { AtsProvider } from "../ats/types";
import { runAtsPipeline } from "../ats/pipeline";
import type { ScoredJob } from "../ats/pipeline";
import { dedupeJobs } from "../utils";
import { getExistingJobDedupeMap } from "@/lib/jobs/jobDedupe";
import { automationLogger } from "@/lib/automation-logger";
import { log } from "@/lib/telemetry";
import type { BoardFailure, RunnerResult, ResumeWithSections } from "./types";
import {
  getAutomationMatchLimit,
  getDefaultModelForProvider,
  getUserAiSettings,
} from "./aiSettings";
import { parseAtsConfig } from "./config";
import { extractResumeSkills } from "./resumeText";
import { buildSkillTerms } from "./skillTags";
import { persistDiscoveredJob, scalePrerank } from "./persist";
import { matchJobToResume } from "./match";
import {
  getUserDealBreakers,
  getWithdrawnStatusId,
} from "@/lib/jobs/dealBreakers";
import { finalizeRun } from "./finalize";

export async function runAtsRun(
  automation: Automation,
  provider: AtsProvider,
  runId: string,
  resume: ResumeWithSections,
  signal?: AbortSignal,
): Promise<RunnerResult> {
  const label = `[${provider.label}]`;
  const noun = provider.sourceNoun ?? "companies";
  const config = parseAtsConfig(automation.sourceConfig, automation.jobBoard);

  if (!config || config.companies.length === 0) {
    automationLogger.log(
      automation.id,
      "error",
      `${label} No ${noun} configured`,
    );
    automationLogger.endRun(automation.id);
    return await finalizeRun(runId, {
      status: "failed",
      errorMessage: provider.id === "remote" ? "no_job_boards" : "no_companies",
      jobsSearched: 0,
      jobsDeduplicated: 0,
      jobsProcessed: 0,
      jobsMatched: 0,
      jobsSaved: 0,
    });
  }

  try {
    automationLogger.log(
      automation.id,
      "info",
      `${label} Fetching ${config.companies.length} ${noun}...`,
    );

    const { jobs, errors } = await provider.search(config.companies, {
      targetTitles: config.targetTitles,
      keywords: config.keywords,
      userId: automation.userId,
      jsearch: config.jsearch,
    });

    for (const err of errors) {
      automationLogger.log(
        automation.id,
        "warning",
        `${label} Board '${err.token}' ${err.reason} — skipped`,
      );
    }

    const nameByToken = new Map(config.companies.map((c) => [c.token, c.name]));
    const boardErrors: BoardFailure[] = errors.map((e) => ({
      token: e.token,
      name: nameByToken.get(e.token) ?? e.token,
      reason: e.reason,
    }));
    const total = config.companies.length;

    if (errors.length > 0 && errors.length === total) {
      const message = `All ${total} boards unreachable`;
      automationLogger.log(automation.id, "error", `${label} ${message}`);
      automationLogger.endRun(automation.id);
      return await finalizeRun(runId, {
        status: "failed",
        errorMessage: message,
        boardErrors,
        jobsSearched: 0,
        jobsDeduplicated: 0,
        jobsProcessed: 0,
        jobsMatched: 0,
        jobsSaved: 0,
      });
    }

    const boardNote =
      errors.length > 0 ? `${errors.length} of ${total} boards unreachable` : null;
    // One place decides the terminal status for every completed path below.
    const outcome = (aiError: string | null) => ({
      status: aiError || boardNote ? ("completed_with_errors" as const) : ("completed" as const),
      // Joined only for Run History; notifications read aiError directly.
      errorMessage: [aiError, boardNote].filter(Boolean).join("; ") || undefined,
      aiError: aiError ?? undefined,
      boardErrors,
    });

    const jobsSearched = jobs.length;
    automationLogger.log(
      automation.id,
      "success",
      `${label} Fetched ${jobsSearched} jobs across ${config.companies.length} boards`,
      { jobsSearched },
    );

    // Dedup against existing jobs and within this batch.
    const existingKeys = await getExistingJobDedupeMap(automation.userId);
    const dedupedJobs = dedupeJobs(jobs, existingKeys);
    const jobsDeduplicated = dedupedJobs.length;

    automationLogger.log(
      automation.id,
      "info",
      `${label} ${jobsDeduplicated} new jobs after dedup`,
      { jobsDeduplicated },
    );

    if (jobsDeduplicated === 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${label} All fetched jobs already saved — nothing new to process`,
      );
      automationLogger.endRun(automation.id);
      return await finalizeRun(runId, {
        ...outcome(null),
        jobsSearched,
        jobsDeduplicated: 0,
        jobsProcessed: 0,
        jobsMatched: 0,
        jobsSaved: 0,
      });
    }

    const resumeSkills = extractResumeSkills(resume);
    const skillTerms = buildSkillTerms(resume);

    // The distinct pool scoreJob actually ranks against. Surfacing it makes a
    // thin search visible instead of showing up only as an unexplained zero.
    const termCount = new Set(
      [...config.keywords, ...resumeSkills]
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ).size;
    automationLogger.log(
      automation.id,
      "info",
      `${label} Ranking against ${termCount} search term(s) (${config.keywords.length} keyword(s) + ${resumeSkills.length} resume skill(s))`,
    );

    const pipeline = runAtsPipeline(dedupedJobs, config, resumeSkills, {
      corpus: jobs,
      k: config.topK,
      locationMatcher: provider.locationMatches,
      neutralWeights: provider.keywordSearched,
    });

    if (pipeline.funnel.excluded !== null) {
      const removed = jobsDeduplicated - pipeline.funnel.excluded;
      const byWord = Object.entries(pipeline.funnel.excludedBy)
        .sort((a, b) => b[1] - a[1])
        .map(([word, n]) => `${word}: ${n}`)
        .join(", ");
      automationLogger.log(
        automation.id,
        "info",
        removed > 0
          ? `${label} ${removed} listing(s) dropped by exclude keywords (${byWord})`
          : `${label} No listings contained an exclude keyword`,
      );
    }

    if (config.strictLocation && config.locations.length > 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${label} ${pipeline.funnel.located} jobs remaining after strict location filter`,
      );
    }

    const capped =
      pipeline.funnel.floorSurvivors > pipeline.funnel.relevant
        ? ` (capped to ${pipeline.funnel.relevant})`
        : "";
    automationLogger.log(
      automation.id,
      "info",
      `${label} ${pipeline.funnel.floorSurvivors} jobs cleared the relevance floor${capped}`,
    );
    if (pipeline.funnel.scoreCut > 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${label} ${pipeline.funnel.scoreCut} of them too weakly related to analyze — skipped`,
      );
    }

    const buildFunnel = (analyzed: number, highlighted: number): string => {
      const stages: FunnelStage[] = [
        { key: "fetched", label: "Fetched", count: jobsSearched },
        { key: "dedup", label: "New", count: jobsDeduplicated },
      ];
      if (pipeline.funnel.excluded !== null) {
        stages.push({
          key: "excluded",
          label: "Not excluded",
          count: pipeline.funnel.excluded,
        });
      }
      if (pipeline.funnel.located !== null) {
        stages.push({
          key: "located",
          label: "In location",
          count: pipeline.funnel.located,
        });
      }
      stages.push({
        key: "floor",
        label: "Relevant",
        count: pipeline.funnel.relevant,
      });
      stages.push({ key: "analyzed", label: "Analyzed", count: analyzed });
      stages.push({
        key: "highlighted",
        label: "Strong match",
        count: highlighted,
      });
      return JSON.stringify(stages);
    };

    if (pipeline.funnel.relevant === 0) {
      // Re-rank the pre-dedup corpus so an exhausted board (everything that
      // matches is already saved) reads differently from a search that matches
      // nothing at all. Only pays for itself on this zero path.
      const beforeDedup = runAtsPipeline(jobs, config, resumeSkills, {
        corpus: jobs,
        k: config.topK,
        locationMatcher: provider.locationMatches,
        neutralWeights: provider.keywordSearched,
      });
      let reason: string;
      if (beforeDedup.funnel.relevant > 0) {
        reason = `all ${beforeDedup.funnel.relevant} matching job(s) on these boards are already in your list — no new postings since the last run`;
      } else if (pipeline.funnel.excluded === 0) {
        reason = `all ${jobsDeduplicated} new job(s) contained an exclude keyword`;
      } else if (pipeline.funnel.located === 0) {
        reason = `none of the ${jobsDeduplicated} new job(s) matched your location filter (${config.locations.join(", ")})`;
      } else {
        const checked = pipeline.funnel.located ?? jobsDeduplicated;
        reason = `none of the ${checked} job(s) checked contained any of your ${termCount} search term(s)`;
      }
      automationLogger.log(
        automation.id,
        "warning",
        `${label} No relevant jobs found — ${reason}. Run complete.`,
      );
      automationLogger.endRun(automation.id);
      return await finalizeRun(runId, {
        ...outcome(null),
        funnelStats: buildFunnel(0, 0),
        jobsSearched,
        jobsDeduplicated,
        jobsProcessed: 0,
        jobsMatched: 0,
        jobsSaved: 0,
      });
    }

    const aiSettings = await getUserAiSettings(automation.userId);
    const modelName =
      aiSettings.model || getDefaultModelForProvider(aiSettings.provider);
    const limit = getAutomationMatchLimit(aiSettings.provider);
    const dealBreakerSettings = await getUserDealBreakers(automation.userId);
    const withdrawnStatusId =
      dealBreakerSettings.withdraw && dealBreakerSettings.items.length > 0
        ? await getWithdrawnStatusId()
        : null;
    let dealBroken = 0;

    let jobsSaved = 0;
    let jobsTagged = 0;
    let analyzed = 0;
    let highlighted = 0;
    let belowThreshold = 0;
    let aiError: string | null = null;

    // Save the un-analyzed tier (floor survivors beyond the top-K).
    if (signal?.aborted) {
      automationLogger.log(
        automation.id,
        "warning",
        `${label} Run aborted by user`,
      );
    }
    if (config.saveUnanalyzed) {
      for (const scored of pipeline.toSaveUnanalyzed) {
        if (signal?.aborted) break;
        try {
          const { saved, tagsApplied } = await persistDiscoveredJob(
            automation,
            scored.job,
            scalePrerank(scored.score),
            {
              prerankScore: scored.score,
              prerankComponents: scored.components,
              analyzed: false,
            },
            skillTerms,
          );
          if (saved) {
            jobsSaved++;
            if (tagsApplied > 0) jobsTagged++;
          }
        } catch (err) {
          log.error("[ATS] Failed to save listing", {
            "automation.id": automation.id,
            provider: provider.label,
            error: String(err),
          });
        }
      }
    }

    // LLM-analyze the top-K.
    const totalToAnalyze = pipeline.toAnalyze.length;
    automationLogger.log(
      automation.id,
      "info",
      `${label} Running LLM analysis on top ${totalToAnalyze}...`,
    );

    const analyzeJob = async (scored: ScoredJob): Promise<void> => {
      // Queued tasks bail silently as slots free; the abort is logged once
      // after all dispatched tasks settle.
      if (signal?.aborted) return;

      const saveUnanalyzed = async () => {
        try {
          const { saved, tagsApplied } = await persistDiscoveredJob(
            automation,
            scored.job,
            scalePrerank(scored.score),
            {
              prerankScore: scored.score,
              prerankComponents: scored.components,
              analyzed: false,
            },
            skillTerms,
          );
          if (saved) {
            jobsSaved++;
            if (tagsApplied > 0) jobsTagged++;
          }
        } catch (err) {
          log.error("[ATS] Failed to save listing", {
            "automation.id": automation.id,
            provider: provider.label,
            error: String(err),
          });
        }
      };

      if (aiError) {
        await saveUnanalyzed();
        return;
      }

      automationLogger.log(
        automation.id,
        "info",
        `${label} Analyzing: ${scored.job.title} at ${scored.job.company}`,
      );

      const matchResult = await matchJobToResume(
        scored.job,
        resume,
        automation.jobBoard,
        aiSettings,
        automation.userId,
        signal,
        dealBreakerSettings.items,
      );

      // Abort may have fired mid-call; bail before saving this job. This
      // check must come before the failure branch below, since an aborted
      // match resolves as a non-ai_unavailable failure and would otherwise
      // incorrectly saveUnanalyzed() a cancelled run's job.
      if (signal?.aborted) return;

      if (!matchResult.success) {
        if (matchResult.error === "ai_unavailable") {
          // Only the first concurrent task to fail logs; siblings stay quiet.
          if (!aiError) {
            aiError = `AI provider (${aiSettings.provider}) is not available.`;
            automationLogger.log(automation.id, "error", aiError);
          }
        } else {
          automationLogger.log(
            automation.id,
            "warning",
            `${label} LLM match failed: ${matchResult.error}`,
          );
        }
        await saveUnanalyzed();
        return;
      }

      analyzed++;
      const isStrong = matchResult.score >= automation.matchThreshold;
      const found = matchResult.dealBreakers?.found ?? [];
      // A strong match with a deal breaker is saved straight to Withdrawn so
      // it stays visible (and is never re-discovered) but is not highlighted.
      const withdraw = isStrong && found.length > 0 && !!withdrawnStatusId;
      if (withdraw) dealBroken++;
      else if (isStrong) highlighted++;
      else belowThreshold++;

      const dealNote =
        found.length > 0
          ? ` — deal breaker: ${found.join(", ")}${withdraw ? " (saved as Withdrawn)" : ""}`
          : "";
      automationLogger.log(
        automation.id,
        isStrong && !withdraw ? "success" : found.length > 0 ? "warning" : "info",
        `${label} Analyzed ${analyzed}/${totalToAnalyze}: ${scored.job.title} — ${matchResult.score}%${isStrong ? "" : ` (below ${automation.matchThreshold}% threshold — not saved)`}${dealNote}`,
        { score: matchResult.score, threshold: automation.matchThreshold },
      );

      if (!isStrong) return;

      try {
        const { saved, tagsApplied } = await persistDiscoveredJob(
          automation,
          scored.job,
          matchResult.score,
          {
            ...matchResult.data,
            ...(withdraw && matchResult.dealBreakers
              ? { dealBreakers: { ...matchResult.dealBreakers, withdrawn: true } }
              : {}),
            resumeId: resume.id,
            resumeTitle: resume.title,
            matchedAt: new Date().toISOString(),
            provider: aiSettings.provider,
            model: modelName,
            prerankScore: scored.score,
            prerankComponents: scored.components,
            analyzed: true,
          },
          skillTerms,
          withdraw ? withdrawnStatusId! : undefined,
        );
        if (saved) {
          jobsSaved++;
          if (tagsApplied > 0) jobsTagged++;
        }
      } catch (err) {
        log.error("[ATS] Failed to save analyzed job", {
          "automation.id": automation.id,
          provider: provider.label,
          error: String(err),
        });
      }
    };

    await Promise.allSettled(
      pipeline.toAnalyze.map((scored) => limit(() => analyzeJob(scored))),
    );

    if (signal?.aborted) {
      automationLogger.log(
        automation.id,
        "warning",
        `${label} Run aborted by user`,
      );
    }

    automationLogger.log(
      automation.id,
      "success",
      `${label} LLM analysis complete (${analyzed}/${pipeline.toAnalyze.length} succeeded)`,
    );

    if (belowThreshold > 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${label} ${belowThreshold} analyzed job(s) scored below your ${automation.matchThreshold}% threshold and were not saved`,
      );
    }

    if (dealBroken > 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${label} ${dealBroken} strong match(es) hit a deal breaker and were saved as Withdrawn`,
      );
    }

    if (jobsSaved > 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${label} Tagged ${jobsTagged} of ${jobsSaved} saved job(s) with skills from your resume`,
      );
    }

    automationLogger.endRun(automation.id);

    return await finalizeRun(runId, {
      ...(signal?.aborted ? { status: "cancelled" as const } : outcome(aiError)),
      funnelStats: buildFunnel(analyzed, highlighted),
      jobsSearched,
      jobsDeduplicated,
      jobsProcessed: analyzed,
      jobsMatched: highlighted,
      jobsSaved,
    });
  } catch (error) {
    // An abort surfaces here as an AbortError; finalize as cancelled, not failed.
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      automationLogger.log(automation.id, "warning", `${label} Run aborted by user`);
      automationLogger.endRun(automation.id);
      return await finalizeRun(runId, {
        status: "cancelled",
        jobsSearched: 0,
        jobsDeduplicated: 0,
        jobsProcessed: 0,
        jobsMatched: 0,
        jobsSaved: 0,
      });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    automationLogger.log(
      automation.id,
      "error",
      `${label} Run failed: ${message}`,
    );
    automationLogger.endRun(automation.id);
    log.error("[ATS] Run failed", {
      "automation.id": automation.id,
      "run.id": runId,
      provider: provider.label,
      error: message,
    });
    return await finalizeRun(runId, {
      status: "failed",
      errorMessage: message,
      jobsSearched: 0,
      jobsDeduplicated: 0,
      jobsProcessed: 0,
      jobsMatched: 0,
      jobsSaved: 0,
    });
  }
}
