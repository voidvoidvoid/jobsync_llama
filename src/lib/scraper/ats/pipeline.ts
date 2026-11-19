import { APP_CONSTANTS } from "@/lib/constants";
import type { PrerankComponents } from "@/models/ai.schemas";
import type { JobDetails } from "../types";
import {
  scoreJob,
  passesFloor,
  locationMatches,
  buildIdf,
  termInText,
} from "./rank";

export interface PipelineConfig {
  targetTitles: string[];
  keywords: string[];
  locations: string[];
  strictLocation: boolean;
  // Words that disqualify a listing, and where to look for them
  excludeKeywords?: string[];
  excludeIn?: "all" | "title";
}

// The first exclude word a listing contains, or null. Whole words and phrases
// only, as keywords are matched ("java" does not exclude "JavaScript"), case
// ignored, in the title and (unless "title") the description's text.
export function firstExcludedWord(
  job: JobDetails,
  words: string[],
  scope: "all" | "title" = "all",
): string | null {
  if (words.length === 0) return null;
  const text =
    scope === "title"
      ? job.title
      : `${job.title} ${(job.description ?? "").replace(/<[^>]+>/g, " ")}`;
  for (const word of words) {
    if (termInText(text, word)) return word.trim();
  }
  return null;
}

export interface ScoredJob {
  job: JobDetails;
  score: number;
  components: PrerankComponents;
}

export interface PipelineResult {
  // Top-K survivors to LLM-analyze (highest scoring).
  toAnalyze: ScoredJob[];
  // Remaining floor survivors saved un-analyzed.
  toSaveUnanalyzed: ScoredJob[];
  funnel: {
    deduped: number; // jobs handed in (already deduped by the runner)
    excluded: number | null; // survivors after exclude keywords (null if none set)
    located: number | null; // survivors after strict location gate (null if off)
    // How many listings each exclude word removed (first matching word only)
    excludedBy: Record<string, number>;
    floorSurvivors: number; // jobs clearing the floor, before the cap ceiling
    scoreCut: number; // floor survivors dropped by the minimum-score gate
    relevant: number; // survivors after the score gate and cap (the LLM budget)
  };
}

// Pure funnel: optional strict-location gate -> score -> relevance floor ->
// cap ceiling -> top-K split. No I/O, no LLM; unit-testable in isolation.
export function runAtsPipeline(
  fetchedJobs: JobDetails[],
  config: PipelineConfig,
  resumeSkills: string[],
  options?: {
    k?: number;
    cap?: number;
    corpus?: JobDetails[];
    // Count every term hit equally instead of weighting by rarity in the
    // corpus. For corpora that are themselves keyword-search results.
    neutralWeights?: boolean;
    // Board-specific strict-location test; defaults to locationMatches
    locationMatcher?: (jobLocation: string, wanted: string[]) => boolean;
  },
): PipelineResult {
  const k = options?.k ?? APP_CONSTANTS.MAX_JOBS_PER_RUN;
  const cap = options?.cap ?? APP_CONSTANTS.ATS_LISTING_CAP;

  const deduped = fetchedJobs.length;

  // Term-rarity weights are derived from the full fetched corpus (pre-dedup) so
  // they stay stable on steady-state runs where few new jobs remain.
  const idf = options?.neutralWeights
    ? () => 1
    : buildIdf(options?.corpus ?? fetchedJobs);

  // Exclude keywords first: a disqualified listing is never ranked, saved or
  // sent to the AI, whatever else it matches.
  const excludeWords = (config.excludeKeywords ?? []).filter((w) => w.trim());
  const excludedBy: Record<string, number> = {};
  const kept =
    excludeWords.length > 0
      ? fetchedJobs.filter((job) => {
          const word = firstExcludedWord(job, excludeWords, config.excludeIn);
          if (word === null) return true;
          excludedBy[word] = (excludedBy[word] ?? 0) + 1;
          return false;
        })
      : null;

  const gateActive = config.strictLocation && config.locations.length > 0;
  const matchesLocation = options?.locationMatcher ?? locationMatches;
  const afterExclude = kept ?? fetchedJobs;
  const located = gateActive
    ? afterExclude.filter((job) =>
        matchesLocation(job.location, config.locations),
      )
    : null;

  const working = located ?? afterExclude;

  const scored: ScoredJob[] = working.map((job) => {
    const { score, components } = scoreJob(
      job,
      config.targetTitles,
      config.keywords,
      resumeSkills,
      config.locations,
      idf,
    );
    return {
      job,
      score,
      components: options?.neutralWeights
        ? { ...components, weighting: "count" as const }
        : components,
    };
  });

  const floorSurvivors = scored
    .filter((s) => passesFloor(s.components))
    .sort((a, b) => b.score - a.score);

  // Term presence is not enough to be worth an LLM call — a single generic hit
  // clears the floor. Cut the weak tail by weighted score too. Fails open: idf
  // is corpus-relative, so a board where every job shares the user's terms
  // scores everything near zero, and dropping that whole run would be worse
  // than analyzing it.
  const strong = floorSurvivors.filter(
    (s) => s.score >= APP_CONSTANTS.ATS_MIN_PRERANK_SCORE,
  );
  const ranked = strong.length > 0 ? strong : floorSurvivors;

  const capped = ranked.slice(0, cap);

  return {
    toAnalyze: capped.slice(0, k),
    toSaveUnanalyzed: capped.slice(k),
    funnel: {
      deduped,
      excluded: kept ? kept.length : null,
      excludedBy,
      located: located ? located.length : null,
      floorSurvivors: floorSurvivors.length,
      scoreCut: floorSurvivors.length - ranked.length,
      relevant: capped.length,
    },
  };
}
