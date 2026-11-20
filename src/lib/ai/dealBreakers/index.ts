import type { JobMatchDealBreakers } from "@/models/ai.schemas";

// Isomorphic: shared by the server match surfaces and the client renderers.

// Section the model writes when (and only when) it finds a deal breaker.
export const DEAL_BREAKERS_SECTION = "Deal Breakers Found";

// Keeps the user's phrase from breaking out of its quoted list item.
function sanitize(item: string): string {
  return item.replace(/[\r\n"]+/g, " ").replace(/\s+/g, " ").trim();
}

// Appended to a match system prompt when the user has deal breakers. The
// prompts already put SCORES on line 1; this adds the verdict on line 2 and,
// for hits, a short evidence section.
export function buildDealBreakerInstructions(items: string[]): string {
  const list = items
    .map(sanitize)
    .filter(Boolean)
    .map((item, i) => `${i + 1}. "${item}"`)
    .join("\n");
  if (!list) return "";
  return `

## DEAL BREAKER CHECK (REQUIRED)
The candidate will not take a job that has any of these conditions:
${list}

Check the job description for each one. Count it as found only when the description clearly states or requires it, in any wording (for example "up to 25% travel" counts for "occasional travel"; "relocation assistance available" does NOT count for "must be willing to relocate", because it is not a requirement). Do not count something the description only leaves unclear, and never use the resume for this check.

The SECOND line of your response, right after the SCORES line, MUST be exactly:

DEAL_BREAKERS: <comma-separated numbers of the conditions found, or none>

If any were found, also add a "## ${DEAL_BREAKERS_SECTION}" section (allowed even where other sections are not) with one bullet per found condition: its wording, then a short quote from the job description that shows it. The deal breaker check does not change the match score.`;
}

export function withDealBreakers(systemPrompt: string, items: string[]): string {
  return items.length > 0
    ? systemPrompt + buildDealBreakerInstructions(items)
    : systemPrompt;
}

// Maps the 1-based numbers from the DEAL_BREAKERS line back to the user's
// phrases. Undefined hits (line missing) mean the check did not happen, so
// nothing is recorded and nothing is withdrawn.
export function resolveDealBreakers(
  items: string[],
  hits: number[] | undefined,
): JobMatchDealBreakers | undefined {
  if (items.length === 0 || !hits) return undefined;
  const found = hits
    .filter((n) => n >= 1 && n <= items.length)
    .map((n) => items[n - 1]);
  return { checked: [...items], found };
}

// Reads the deal breaker result from a stored matchData string or object.
export function dealBreakersFromMatchData(
  matchData: unknown,
): JobMatchDealBreakers | undefined {
  let data = matchData;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  const db = (data as { dealBreakers?: unknown } | null)?.dealBreakers as
    | Partial<JobMatchDealBreakers>
    | undefined;
  if (!db || !Array.isArray(db.found) || !Array.isArray(db.checked)) {
    return undefined;
  }
  return {
    checked: db.checked.filter((x): x is string => typeof x === "string"),
    found: db.found.filter((x): x is string => typeof x === "string"),
    ...(db.withdrawn ? { withdrawn: true } : {}),
  };
}
