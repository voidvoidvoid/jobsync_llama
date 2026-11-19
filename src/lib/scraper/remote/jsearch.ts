import { APP_CONSTANTS } from "@/lib/constants";
import { resolveApiKey } from "@/lib/api-key-resolver";
import { jsearchOptions, type JSearchOptions } from "@/models/automation.model";
import type { JobDetails, ScraperResult } from "../types";
import { feedDelay, formatSalary, text } from "./http";
import { compactRemoteLocation } from "./location";

export const JSEARCH = "JSearch";

// Where a key was bought decides the host and headers. The plan behind it
// (free or paid) changes only how many requests it allows.
export type JSearchKey = { key: string; via: "direct" | "rapidapi" };

export async function resolveJSearchKey(
  userId: string | undefined,
): Promise<JSearchKey | null> {
  const direct = await resolveApiKey(userId, "jsearch");
  if (direct) return { key: direct, via: "direct" };
  const rapid = await resolveApiKey(userId, "jsearch-rapidapi");
  if (rapid) return { key: rapid, via: "rapidapi" };
  return null;
}

// Absent fields arrive as null
interface JSearchJob {
  job_title?: string | null;
  employer_name?: string | null;
  job_publisher?: string | null;
  job_apply_link?: string | null;
  job_google_link?: string | null;
  job_description?: string | null;
  job_is_remote?: boolean | null;
  job_posted_at_datetime_utc?: string | null;
  job_posted_at_timestamp?: number | null;
  job_city?: string | null;
  job_state?: string | null;
  job_country?: string | null;
  job_location?: string | null;
  job_employment_type?: string | null;
  job_min_salary?: number | null;
  job_max_salary?: number | null;
  job_salary_period?: string | null;
}

function locationOf(job: JSearchJob, remote: boolean): string {
  const place =
    text(job.job_location) ||
    [job.job_city, job.job_state, job.job_country]
      .map(text)
      .filter(Boolean)
      .join(", ");
  if (place) return place;
  return remote ? "Remote" : "";
}

// `remoteOnly` drops a listing JSearch itself marks as not remote, in case the
// API's own filter lets one through. Unmarked listings are kept.
export function mapJSearchJob(
  job: JSearchJob,
  remoteOnly: boolean,
): JobDetails | null {
  if (remoteOnly && job.job_is_remote === false) return null;
  const title = text(job.job_title);
  const url = text(job.job_apply_link) || text(job.job_google_link);
  if (!title || !/^https?:\/\//i.test(url)) return null;

  const remote = job.job_is_remote === true || (remoteOnly && job.job_is_remote !== false);
  const location = locationOf(job, remote);
  const posted =
    text(job.job_posted_at_datetime_utc) ||
    (typeof job.job_posted_at_timestamp === "number" && job.job_posted_at_timestamp > 0
      ? new Date(job.job_posted_at_timestamp * 1000).toISOString()
      : "");

  return {
    title,
    company: text(job.employer_name) || "Unknown company",
    location: location || "Unknown",
    locationLabel: compactRemoteLocation(location),
    description: text(job.job_description),
    url,
    postedDate:
      posted && !Number.isNaN(Date.parse(posted))
        ? new Date(posted).toISOString()
        : undefined,
    salary: formatSalary(
      job.job_min_salary,
      job.job_max_salary,
      undefined,
      typeof job.job_salary_period === "string"
        ? job.job_salary_period.toLowerCase()
        : undefined,
    ),
    employmentType: text(job.job_employment_type) || undefined,
    isRemote: remote,
    workplaceType: remote ? "REMOTE" : undefined,
    // The site JSearch found it on ("LinkedIn", "Indeed") is the job's source
    source: text(job.job_publisher) || JSEARCH,
  };
}

type Page = { jobs: unknown[]; cursor?: string };

// One request. A direct key asks for one page at a time (search-v2, cursor
// paged); a RapidAPI key asks for all `pages` at once with num_pages. Either
// way each 10-result page costs one request from the plan.
export async function jsearchRequest(
  credential: JSearchKey,
  params: {
    query: string;
    pages: number;
    remoteOnly: boolean;
    datePosted: string;
    cursor?: string;
  },
): Promise<ScraperResult<Page>> {
  const search = new URLSearchParams({
    query: params.query,
    date_posted: params.datePosted,
  });
  if (params.remoteOnly) search.set("work_from_home", "true");

  let url: string;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": APP_CONSTANTS.REMOTE_FEED_USER_AGENT,
  };
  if (credential.via === "rapidapi") {
    search.set("page", "1");
    search.set("num_pages", String(params.pages));
    url = `${APP_CONSTANTS.JSEARCH_RAPIDAPI_URL}?${search}`;
    headers["X-RapidAPI-Key"] = credential.key;
    headers["X-RapidAPI-Host"] = APP_CONSTANTS.JSEARCH_RAPIDAPI_HOST;
  } else {
    if (params.cursor) search.set("cursor", params.cursor);
    url = `${APP_CONSTANTS.JSEARCH_DIRECT_URL}?${search}`;
    headers["x-api-key"] = credential.key;
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    APP_CONSTANTS.REMOTE_FEED_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, { headers, signal: controller.signal });

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        error: {
          type: "blocked",
          reason: `${JSEARCH} rejected the API key (${response.status}). Check it, or its subscription, in Settings → API Keys`,
        },
      };
    }
    // The free plan's monthly allowance is a hard limit, also reported as 429
    if (response.status === 429) {
      return { success: false, error: { type: "rate_limited" } };
    }
    if (!response.ok) {
      return {
        success: false,
        error: {
          type: "network",
          message: `${JSEARCH} returned ${response.status}`,
        },
      };
    }

    let body: any;
    try {
      body = await response.json();
    } catch {
      return {
        success: false,
        error: { type: "parse", message: `${JSEARCH} sent a malformed response` },
      };
    }
    const jobs = Array.isArray(body?.data)
      ? body.data
      : Array.isArray(body?.data?.jobs)
        ? body.data.jobs
        : null;
    if (!jobs) {
      return {
        success: false,
        error: { type: "parse", message: `${JSEARCH} sent a malformed response` },
      };
    }
    const cursor =
      text(body?.cursor) || text(body?.next_cursor) || text(body?.data?.cursor);
    return { success: true, data: { jobs, cursor: cursor || undefined } };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        error: { type: "network", message: `${JSEARCH} timed out` },
      };
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: { type: "network", message } };
  } finally {
    clearTimeout(timer);
  }
}

// Searches each term for its newest postings. Requests are sequential and
// counted exactly: terms × pagesPerTerm, which is what the wizard shows as
// the cost of a run. A failure part-way keeps what was already fetched.
export async function fetchJSearchJobs(
  terms: string[],
  userId: string | undefined,
  options?: JSearchOptions,
): Promise<ScraperResult<JobDetails[]>> {
  if (terms.length === 0) {
    return {
      success: false,
      error: {
        type: "parse",
        message: `${JSEARCH} needs at least one job title or keyword to search for`,
      },
    };
  }

  const credential = await resolveJSearchKey(userId);
  if (!credential) {
    return {
      success: false,
      error: {
        type: "blocked",
        reason: `${JSEARCH} has no API key. Add one in Settings → API Keys`,
      },
    };
  }

  const { remoteOnly, pagesPerTerm, datePosted } = jsearchOptions(options);
  const jobs: JobDetails[] = [];
  let requests = 0;

  const fail = (result: ScraperResult<unknown> & { success: false }) =>
    jobs.length === 0 && requests === 1
      ? result
      : ({ success: true, data: jobs } as const);

  for (const term of terms) {
    // RapidAPI returns every page in one request; direct keys page by cursor
    const calls = credential.via === "rapidapi" ? 1 : pagesPerTerm;
    let cursor: string | undefined;
    for (let call = 0; call < calls; call++) {
      if (requests > 0) await feedDelay();
      const result = await jsearchRequest(credential, {
        query: term,
        pages: pagesPerTerm,
        remoteOnly,
        datePosted,
        cursor,
      });
      requests++;
      if (!result.success) return fail(result);

      for (const raw of result.data.jobs) {
        if (!raw || typeof raw !== "object") continue;
        const mapped = mapJSearchJob(raw as JSearchJob, remoteOnly);
        if (mapped) jobs.push(mapped);
      }
      cursor = result.data.cursor;
      if (!cursor || result.data.jobs.length < 10) break;
    }
  }

  return { success: true, data: jobs };
}
