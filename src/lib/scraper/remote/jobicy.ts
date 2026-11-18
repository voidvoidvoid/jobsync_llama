import { APP_CONSTANTS } from "@/lib/constants";
import type { JobDetails, ScraperResult } from "../types";
import { decodeHtml } from "../html";
import { feedDelay, fetchFeedJson, formatSalary, text } from "./http";
import { compactRemoteLocation } from "./location";

export const JOBICY = "Jobicy";

interface JobicyJob {
  url?: string;
  jobTitle?: string;
  companyName?: string;
  jobType?: unknown;
  jobGeo?: string;
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string;
  salaryPeriod?: string;
}

export function mapJobicyJob(job: JobicyJob): JobDetails | null {
  // Titles and company names arrive entity-encoded ("R&amp;D Engineer").
  const title = decodeHtml(text(job.jobTitle));
  const url = text(job.url);
  if (!title || !/^https?:\/\//i.test(url)) return null;

  const posted = text(job.pubDate);
  const type = Array.isArray(job.jobType) ? job.jobType[0] : job.jobType;

  const location = decodeHtml(text(job.jobGeo)) || "Anywhere";

  return {
    title,
    company: decodeHtml(text(job.companyName)) || "Unknown company",
    location,
    locationLabel: compactRemoteLocation(location),
    description: text(job.jobDescription) || text(job.jobExcerpt),
    url, // the canonical Jobicy page, which Jobicy asks to be kept
    postedDate:
      posted && !Number.isNaN(Date.parse(posted))
        ? new Date(posted).toISOString()
        : undefined,
    salary: formatSalary(
      job.salaryMin,
      job.salaryMax,
      job.salaryCurrency,
      job.salaryPeriod,
    ),
    employmentType: text(type) || undefined,
    isRemote: true,
    workplaceType: "REMOTE",
    source: JOBICY,
  };
}

// Jobicy's `tag` search takes 3-50 characters.
function usableTerms(terms: string[]): string[] {
  return terms
    .filter((term) => term.length >= 3 && term.length <= 50)
    .slice(0, APP_CONSTANTS.JOBICY_MAX_TERMS);
}

// One request per search term (the first few only: Jobicy asks integrations to
// poll sparingly), or a single request for the newest postings when there are
// no usable terms. Sequential; a failure part-way keeps what was fetched.
export async function fetchJobicyJobs(
  terms: string[],
): Promise<ScraperResult<JobDetails[]>> {
  const jobs: JobDetails[] = [];
  const tags = usableTerms(terms);
  const queries: (string | null)[] = tags.length > 0 ? tags : [null];

  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await feedDelay();
    const params = new URLSearchParams({
      count: String(APP_CONSTANTS.JOBICY_COUNT),
    });
    if (queries[i] !== null) params.set("tag", queries[i] as string);

    const result = await fetchFeedJson(
      `${APP_CONSTANTS.JOBICY_API_URL}?${params}`,
      JOBICY,
    );
    if (!result.success) {
      if (i === 0) return result;
      break;
    }

    const list = (result.data as { jobs?: unknown } | null)?.jobs;
    if (!Array.isArray(list)) {
      if (i === 0) {
        return {
          success: false,
          error: { type: "parse", message: `${JOBICY} sent a malformed response` },
        };
      }
      break;
    }

    for (const raw of list) {
      const mapped = mapJobicyJob(raw as JobicyJob);
      if (mapped) jobs.push(mapped);
    }
  }

  return { success: true, data: jobs };
}
