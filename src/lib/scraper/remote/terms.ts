import { APP_CONSTANTS } from "@/lib/constants";
import type { AtsSearchQuery } from "../ats/types";

// The phrases sent to a feed's own search, most specific first: target titles
// ("Data Engineer"), then keywords ("Kubernetes"). Case-insensitively unique
// and capped, because each term costs every searched feed a request.
export function buildSearchTerms(query?: AtsSearchQuery): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of [...(query?.targetTitles ?? []), ...(query?.keywords ?? [])]) {
    const term = raw.trim().replace(/\s+/g, " ");
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= APP_CONSTANTS.REMOTE_FEED_MAX_TERMS) break;
  }
  return terms;
}
