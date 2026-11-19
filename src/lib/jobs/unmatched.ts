// Which saved jobs have no AI match yet. Shared by the AI Matching run and the
// wizard's live count, so both always agree. No server-only imports: plain data.

// What persist.ts writes for a listing saved without AI analysis; the same
// substring the jobs list uses to hide such a job's keyword pre-rank.
export const UNANALYZED_MARKER = '"analyzed":false';

// Jobs in these states are finished with; scoring them spends a request on
// nothing the user will act on.
export const CLOSED_STATUSES = [
  "rejected",
  "expired",
  "archived",
  "withdrawn",
  "offer-declined",
];

export function unmatchedJobsWhere(
  userId: string,
  cfg: { includeDiscovered: boolean; includeTracked: boolean },
) {
  const kinds: object[] = [];
  if (cfg.includeDiscovered) {
    // Saved by a search automation without an AI analysis. Matched on the
    // marker rather than automationId, which is cleared if that automation
    // is deleted; dismissed listings are left alone.
    kinds.push({
      matchData: { contains: UNANALYZED_MARKER },
      OR: [{ discoveryStatus: null }, { discoveryStatus: { not: "dismissed" } }],
    });
  }
  if (cfg.includeTracked) {
    // Added by hand (or through an agent) and never matched
    kinds.push({ automationId: null, matchScore: null });
  }
  return {
    userId,
    Status: { value: { notIn: CLOSED_STATUSES } },
    OR: kinds,
  };
}
