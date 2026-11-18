import { APP_CONSTANTS } from "@/lib/constants";
import type { JobDetails, ScraperResult } from "../types";
import { fetchFeedJson, formatSalary, text } from "./http";

export const REMOTEOK = "Remote OK";

interface RemoteOkJob {
  position?: string;
  company?: string;
  location?: string;
  description?: string;
  date?: string;
  url?: string;
  salary_min?: number;
  salary_max?: number;
}

export function mapRemoteOkJob(job: RemoteOkJob): JobDetails | null {
  const title = text(job.position);
  // Remote OK's terms require linking back to the posting on Remote OK, so
  // `url` is used and never `apply_url`.
  const url = text(job.url);
  if (!title || !/^https?:\/\//i.test(url)) return null;

  const posted = text(job.date);
  // Locations come with stray punctuation ("Berlin, ").
  const location = text(job.location).replace(/[\s,;]+$/, "");

  return {
    title,
    company: text(job.company) || "Unknown company",
    location: location || "Worldwide",
    description: text(job.description),
    url,
    postedDate:
      posted && !Number.isNaN(Date.parse(posted))
        ? new Date(posted).toISOString()
        : undefined,
    salary: formatSalary(job.salary_min, job.salary_max, "USD"),
    isRemote: true,
    workplaceType: "REMOTE",
    source: REMOTEOK,
  };
}

// The whole feed is one request: the newest postings, with no server-side
// search. The run's own ranking does the filtering. The first array element is
// a legal notice rather than a job; it has no `position` and maps to null.
export async function fetchRemoteOkJobs(): Promise<ScraperResult<JobDetails[]>> {
  const result = await fetchFeedJson(APP_CONSTANTS.REMOTEOK_API_URL, REMOTEOK);
  if (!result.success) return result;

  if (!Array.isArray(result.data)) {
    return {
      success: false,
      error: { type: "parse", message: `${REMOTEOK} sent a malformed response` },
    };
  }

  const jobs: JobDetails[] = [];
  for (const raw of result.data) {
    if (!raw || typeof raw !== "object") continue;
    const mapped = mapRemoteOkJob(raw as RemoteOkJob);
    if (mapped) jobs.push(mapped);
  }
  return { success: true, data: jobs };
}
