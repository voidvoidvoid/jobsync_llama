import type { JobDetails, ScraperResult } from "../types";
import type { AtsSearchQuery } from "../ats/types";
import { errorReason, jobDedupeKey } from "../utils";
import { buildSearchTerms } from "./terms";
import { fetchHimalayasJobs } from "./himalayas";
import { fetchJobicyJobs } from "./jobicy";
import { fetchRemoteOkJobs } from "./remoteok";

export { remoteLocationMatches } from "./location";
export { buildSearchTerms } from "./terms";

const FEEDS: Record<
  string,
  (terms: string[]) => Promise<ScraperResult<JobDetails[]>>
> = {
  himalayas: fetchHimalayasJobs,
  jobicy: fetchJobicyJobs,
  remoteok: fetchRemoteOkJobs,
};

// The "remote" board's search. `feeds` arrives in the slot company boards use
// for their watchlist, so each feed fails on its own exactly as one company
// board would. Feeds are read in parallel; requests within a feed are not.
export async function searchRemoteFeeds(
  feeds: { name: string; token: string }[],
  query?: AtsSearchQuery,
): Promise<{ jobs: JobDetails[]; errors: { token: string; reason: string }[] }> {
  const terms = buildSearchTerms(query);

  const settled = await Promise.allSettled(
    feeds.map(({ token }) => {
      const fetchFeed = FEEDS[token];
      if (!fetchFeed) {
        return Promise.resolve<ScraperResult<JobDetails[]>>({
          success: false,
          error: { type: "parse", message: "is not a known job board" },
        });
      }
      return fetchFeed(terms);
    }),
  );

  const jobs: JobDetails[] = [];
  const errors: { token: string; reason: string }[] = [];

  // One posting turns up under several search terms (same URL) and on several
  // feeds (different URLs, same title and company). Keep the first of each so
  // the run's counts and term weights describe distinct jobs.
  const seen = new Set<string>();
  const addUnique = (batch: JobDetails[]) => {
    for (const job of batch) {
      const byUrl = jobDedupeKey(job);
      const byPosting = jobDedupeKey({ title: job.title, company: job.company });
      if (seen.has(byUrl) || seen.has(byPosting)) continue;
      seen.add(byUrl);
      seen.add(byPosting);
      jobs.push(job);
    }
  };

  settled.forEach((result, index) => {
    const token = feeds[index].token;
    if (result.status === "fulfilled") {
      if (result.value.success) addUnique(result.value.data);
      else errors.push({ token, reason: errorReason(result.value.error) });
    } else {
      const reason =
        result.reason instanceof Error ? result.reason.message : "Unknown error";
      errors.push({ token, reason });
    }
  });

  return { jobs, errors };
}
