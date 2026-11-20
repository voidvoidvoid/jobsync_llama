"use server";

import db from "@/lib/db";
import { requireUser } from "../shared";
import { generateText } from "ai";
import { startAiCall } from "@/lib/aiUsage/tracker";
import {
  getModel,
  parseJobMatch,
  JOB_MATCH_SYSTEM_PROMPT,
  buildJobMatchPrompt,
  preprocessResume,
  preprocessJob,
} from "@/lib/ai";
import { resolveDealBreakers, withDealBreakers } from "@/lib/ai/dealBreakers";
import { getResumeById } from "@/actions/profile.actions";
import { getJobDetails } from "@/actions/job.actions";
import { defaultUserSettings } from "@/models/userSettings.model";
import { automationLogger } from "@/lib/automation-logger";
import { getDefaultModelForProvider } from "@/lib/scraper/automation-run/aiSettings";
import { APP_CONSTANTS } from "@/lib/constants";
import {
  genAiRequestAttrs,
  genAiResponseAttrs,
  inputSizeAttrs,
  SURFACES,
  withSpan,
} from "@/lib/telemetry";
import { formatError } from "./shared";
import {
  getUserDealBreakers,
  withdrawForDealBreakers,
} from "@/lib/jobs/dealBreakers";

// Runs an on-demand LLM match for an un-analyzed discovered job using the
// resume tied to its automation and the user's AI settings (no model picker —
// mirrors the automation runner). Upgrades matchData with analyzed: true.
export async function analyzeDiscoveredJob(jobId: string): Promise<{
  success: boolean;
  matchScore?: number;
  dealBreakersFound?: string[];
  withdrawn?: boolean;
  message?: string;
}> {
  try {
    const user = await requireUser();

    const job = await db.job.findFirst({
      where: { id: jobId, userId: user.id, automationId: { not: null } },
      include: { automation: { select: { resumeId: true } } },
    });

    if (!job) {
      return { success: false, message: "Discovered job not found" };
    }

    if (job.automationId && automationLogger.isRunning(job.automationId)) {
      return {
        success: false,
        message:
          "A run is in progress for this automation. Please wait until it completes before analyzing jobs.",
      };
    }

    const resumeId = job.automation?.resumeId;
    if (!resumeId) {
      return { success: false, message: "Automation resume is missing" };
    }

    const userSettings = await db.userSettings.findUnique({
      where: { userId: user.id },
    });
    const ai = userSettings
      ? {
          ...defaultUserSettings.ai,
          ...(JSON.parse(userSettings.settings).ai ?? {}),
        }
      : defaultUserSettings.ai;

    const [{ data: resume }, { job: jobDetails }] = await Promise.all([
      getResumeById(resumeId),
      getJobDetails(jobId),
    ]);

    const [resumePre, jobPre] = await Promise.all([
      preprocessResume(resume),
      preprocessJob(jobDetails),
    ]);

    if (!resumePre.success || !jobPre.success) {
      return { success: false, message: "Failed to prepare match inputs" };
    }

    const modelName = ai.model || getDefaultModelForProvider(ai.provider);
    const model = await getModel(ai.provider, modelName, user.id);

    const dealBreakerSettings = await getUserDealBreakers(user.id);
    const system = withDealBreakers(
      JOB_MATCH_SYSTEM_PROMPT,
      dealBreakerSettings.items,
    );

    const promptText = buildJobMatchPrompt(
      resumePre.data.normalizedText,
      jobPre.data.normalizedText,
    );

    const result = await withSpan(
      "automation.analyze",
      {
        ...genAiRequestAttrs({
          provider: ai.provider,
          model: modelName,
          temperature: 0.3,
          numCtx: APP_CONSTANTS.AI_OLLAMA_NUM_CTX,
          surface: SURFACES.JOB_MATCH,
          system,
          prompt: promptText,
        }),
        ...inputSizeAttrs({
          resumeChars: resumePre.data.normalizedText.length,
          jobChars: jobPre.data.normalizedText.length,
        }),
        "jobsync.user_id": user.id,
        "jobsync.job_id": jobId,
      },
      async (span) => {
        // The Analyze button on a discovered job counts as Automations.
        const tracker = startAiCall({
          userId: user.id,
          feature: "automations",
          provider: ai.provider,
          model: modelName,
        });
        let generated;
        try {
          generated = await generateText({
            model,
            instructions: system,
            prompt: promptText,
            temperature: 0.3,
          });
        } catch (error) {
          void tracker.finish({ error });
          throw error;
        }
        void tracker.finish({
          usage: generated.usage,
          finishReason: generated.finishReason,
        });
        span.setAttrs(
          genAiResponseAttrs({
            usage: generated.usage,
            finishReason: generated.finishReason,
            text: generated.text,
          }),
        );
        return generated;
      },
    );

    const { scores, body, dealBreakerHits } = parseJobMatch(result.text);
    if (!scores) {
      return { success: false, message: "AI did not return a match score" };
    }

    let previous: Record<string, unknown> = {};
    try {
      previous = JSON.parse(job.matchData ?? "{}");
    } catch {
      previous = {};
    }

    const dealBreakers = resolveDealBreakers(
      dealBreakerSettings.items,
      dealBreakerHits,
    );
    // A fresh check replaces the old one; with no list, the old one goes too.
    delete previous.dealBreakers;

    const matchData = JSON.stringify({
      ...previous,
      ...(dealBreakers ? { dealBreakers } : {}),
      matchScore: scores.matchScore,
      recommendation: scores.recommendation,
      body,
      resumeId,
      resumeTitle: resume.title,
      matchedAt: new Date().toISOString(),
      provider: ai.provider,
      model: ai.model,
      analyzed: true,
    });

    await db.job.update({
      where: { id: jobId, userId: user.id },
      data: { matchScore: scores.matchScore, matchData },
    });

    const withdrawn = await withdrawForDealBreakers({
      jobId,
      userId: user.id,
      dealBreakers,
      settings: dealBreakerSettings,
    });

    return {
      success: true,
      matchScore: scores.matchScore,
      dealBreakersFound: dealBreakers?.found ?? [],
      withdrawn,
    };
  } catch (error) {
    return formatError(error, "Failed to analyze discovered job");
  }
}
