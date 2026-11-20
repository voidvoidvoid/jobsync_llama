import db from "@/lib/db";
import { changeJobStatus } from "@/lib/jobs/timeline";
import { createJobFromNames } from "@/lib/jobs/createJobFromNames";

// Server-only. Records that the user submitted an application the extension
// helped fill: moves a saved job to Applied, or adds the job as Applied.

// Statuses an application moves on from. Later stages (interview, offer...)
// are never pulled back to Applied.
const BEFORE_APPLIED = new Set(["new", "draft", "withdrawn", "expired", "archived"]);

export type MarkAppliedResult =
  | { ok: true; jobId: string; created: boolean; changed: boolean; message: string }
  | { ok: false; message: string };

export async function markJobApplied(
  userId: string,
  input:
    | { jobId: string }
    | {
        url: string;
        jobTitle: string;
        company: string;
        description?: string;
      },
): Promise<MarkAppliedResult> {
  if ("jobId" in input) {
    const job = await db.job.findFirst({
      where: { id: input.jobId, userId },
      select: { id: true, Status: { select: { value: true } } },
    });
    if (!job) return { ok: false, message: "That job is not in JobSync." };
    const current = job.Status?.value ?? "";
    if (!BEFORE_APPLIED.has(current)) {
      return {
        ok: true,
        jobId: job.id,
        created: false,
        changed: false,
        message: `Left as ${current || "is"}: it is already past Applied.`,
      };
    }
    const applied = await db.jobStatus.findFirst({
      where: { value: "applied" },
      select: { id: true },
    });
    if (!applied) return { ok: false, message: "JobSync has no Applied status." };
    await changeJobStatus({
      jobId: job.id,
      userId,
      statusId: applied.id,
      appliedDateFromUser: new Date(),
    });
    return { ok: true, jobId: job.id, created: false, changed: true, message: "Marked as Applied." };
  }

  const description = (input.description ?? "").trim();
  const result = await createJobFromNames(
    {
      company: input.company.trim(),
      jobTitle: input.jobTitle.trim(),
      jobDescription: description.length >= 10 ? description : "N/A",
      jobUrl: input.url,
      status: "applied",
      applied: true,
      appliedDate: new Date(),
      createdVia: "Firefox extension",
    },
    userId,
  );
  if (!result.created || !result.jobId) {
    if (result.duplicateOf) {
      return markJobApplied(userId, { jobId: result.duplicateOf.id });
    }
    return { ok: false, message: result.message };
  }
  return { ok: true, jobId: result.jobId, created: true, changed: true, message: "Added to JobSync as Applied." };
}
