import { APP_CONSTANTS } from "@/lib/constants";
import type { JobDetails, ScraperResult } from "../types";
import { fetchFeedJson, text } from "./http";
import { compactRemoteLocation } from "./location";

export const WORKING_NOMADS = "Working Nomads";

interface WorkingNomadsJob {
  url?: string;
  title?: string;
  description?: string;
  company_name?: string;
  location?: string;
  pub_date?: string;
}

export function mapWorkingNomadsJob(job: WorkingNomadsJob): JobDetails | null {
  const title = text(job.title);
  const url = text(job.url);
  if (!title || !/^https?:\/\//i.test(url)) return null;

  const posted = text(job.pub_date);
  const location = text(job.location) || "Anywhere";

  return {
    title,
    company: text(job.company_name) || "Unknown company",
    location,
    locationLabel: compactRemoteLocation(location),
    description: text(job.description),
    url,
    postedDate:
      posted && !Number.isNaN(Date.parse(posted))
        ? new Date(posted).toISOString()
        : undefined,
    isRemote: true,
    workplaceType: "REMOTE",
    source: WORKING_NOMADS,
  };
}

// The board's whole current list is one JSON document with no search of its
// own, so it is one request and the run's ranking does the filtering.
export async function fetchWorkingNomadsJobs(): Promise<
  ScraperResult<JobDetails[]>
> {
  const result = await fetchFeedJson(
    APP_CONSTANTS.WORKINGNOMADS_API_URL,
    WORKING_NOMADS,
  );
  if (!result.success) return result;

  if (!Array.isArray(result.data)) {
    return {
      success: false,
      error: {
        type: "parse",
        message: `${WORKING_NOMADS} sent a malformed response`,
      },
    };
  }

  const jobs: JobDetails[] = [];
  for (const raw of result.data) {
    if (!raw || typeof raw !== "object") continue;
    const mapped = mapWorkingNomadsJob(raw as WorkingNomadsJob);
    if (mapped) jobs.push(mapped);
  }
  return { success: true, data: jobs };
}
