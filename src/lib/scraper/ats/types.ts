import type { JobBoard } from "@/models/automation.model";
import type { JobDetails } from "../types";

// `host` is optional and Lever-only (Greenhouse ignores it); it's persisted
// once a company is resolved so runtime fetches never re-probe regions.
export type AtsHost = "default" | "eu";

// What the user is looking for. Company boards return everything and ignore
// it; keyword-searched feeds (the remote board) query with it.
export interface AtsSearchQuery {
  targetTitles: string[];
  keywords: string[];
}

export interface AtsProvider {
  id: JobBoard;
  label: string; // display name shown in the wizard/detail UI
  // What one entry of `companies` is called in run logs. Default "companies".
  sourceNoun?: string;
  // Fetch a watchlist with bounded concurrency + per-token isolation.
  search(
    companies: { name: string; token: string; host?: AtsHost }[],
    query?: AtsSearchQuery,
  ): Promise<{
    jobs: JobDetails[];
    errors: { token: string; reason: string }[];
  }>;
  // True when `search` returns keyword-search results rather than whole
  // boards. Rarity weighting is then switched off: in a corpus built from the
  // user's own search terms those terms are the commonest words, so weighting
  // by rarity would score the best matches lowest.
  keywordSearched?: boolean;
  // Replaces the default strict-location test (see rank.ts locationMatches).
  locationMatches?: (jobLocation: string, wanted: string[]) => boolean;
}
