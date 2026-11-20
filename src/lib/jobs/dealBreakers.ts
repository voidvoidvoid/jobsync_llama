import db from "@/lib/db";
import { changeJobStatus } from "@/lib/jobs/timeline";
import { log } from "@/lib/telemetry";
import {
  normalizeDealBreakers,
  type DealBreakerSettings,
} from "@/models/userSettings.model";
import type { JobMatchDealBreakers } from "@/models/ai.schemas";

// Not a "use server" module: called from actions, the agent tool and the
// automation runners, each of which has already resolved the user.

// Only jobs the user has not acted on are withdrawn. Applied, interviewing,
// offers and closed jobs keep their status; the flag still shows.
export const DEAL_BREAKER_WITHDRAWABLE = ["new", "draft"] as const;

export async function getUserDealBreakers(
  userId: string,
): Promise<DealBreakerSettings> {
  const row = await db.userSettings.findUnique({ where: { userId } });
  if (!row) return normalizeDealBreakers(undefined);
  try {
    return normalizeDealBreakers(JSON.parse(row.settings).dealBreakers);
  } catch {
    return normalizeDealBreakers(undefined);
  }
}

export async function getWithdrawnStatusId(): Promise<string | null> {
  const status = await db.jobStatus.findFirst({
    where: { value: "withdrawn" },
    select: { id: true },
  });
  return status?.id ?? null;
}

// Moves an existing job to Withdrawn when its match found a deal breaker, and
// stamps the stored match so the panel can say why. Call after the match is
// saved. Returns whether it withdrew; never throws, since the match itself is already
// saved and a failed status change must not lose it.
export async function withdrawForDealBreakers(input: {
  jobId: string;
  userId: string;
  dealBreakers: JobMatchDealBreakers | undefined;
  settings: DealBreakerSettings;
}): Promise<boolean> {
  const { jobId, userId, dealBreakers, settings } = input;
  if (!settings.withdraw || !dealBreakers || dealBreakers.found.length === 0) {
    return false;
  }
  try {
    const job = await db.job.findFirst({
      where: { id: jobId, userId },
      select: { Status: { select: { value: true } } },
    });
    const current = job?.Status?.value;
    if (
      !current ||
      !(DEAL_BREAKER_WITHDRAWABLE as readonly string[]).includes(current)
    ) {
      return false;
    }
    const statusId = await getWithdrawnStatusId();
    if (!statusId) return false;
    await changeJobStatus({ jobId, userId, statusId });
    await markMatchWithdrawn(jobId, userId);
    return true;
  } catch (error) {
    log.error("[DealBreakers] Could not withdraw job", {
      "jobsync.job_id": jobId,
      error: String(error),
    });
    return false;
  }
}

// Stamps withdrawn: true on the stored matchData after a withdrawal, so the
// match panel can say why the status changed.
async function markMatchWithdrawn(
  jobId: string,
  userId: string,
): Promise<void> {
  const job = await db.job.findFirst({
    where: { id: jobId, userId },
    select: { matchData: true },
  });
  if (!job?.matchData) return;
  try {
    const data = JSON.parse(job.matchData);
    if (!data?.dealBreakers) return;
    data.dealBreakers.withdrawn = true;
    await db.job.update({
      where: { id: jobId, userId },
      data: { matchData: JSON.stringify(data) },
    });
  } catch {
    // Leave the stored match as it is.
  }
}
