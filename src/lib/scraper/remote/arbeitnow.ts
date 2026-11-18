import { APP_CONSTANTS } from "@/lib/constants";
import type { JobDetails, ScraperResult } from "../types";
import { feedDelay, fetchFeedJson, text } from "./http";
import { compactRemoteLocation } from "./location";

export const ARBEITNOW = "Arbeitnow";

interface ArbeitnowJob {
  title?: string;
  company_name?: string;
  description?: string;
  remote?: boolean;
  url?: string;
  job_types?: unknown;
  location?: string;
  created_at?: number;
}

// Arbeitnow is a general European board, so only postings it flags as remote
// are kept. `location` is the employer's city ("Berlin"): a remote role there
// is usually open to that country rather than the world, and the city is
// what the location filter is given to judge it by.
export function mapArbeitnowJob(job: ArbeitnowJob): JobDetails | null {
  if (job.remote !== true) return null;
  const title = text(job.title);
  const url = text(job.url);
  if (!title || !/^https?:\/\//i.test(url)) return null;

  const type = Array.isArray(job.job_types) ? job.job_types[0] : undefined;
  const location = text(job.location) || "Europe";

  return {
    title,
    company: text(job.company_name) || "Unknown company",
    location,
    locationLabel: compactRemoteLocation(location),
    description: text(job.description),
    url,
    postedDate:
      typeof job.created_at === "number" && job.created_at > 0
        ? new Date(job.created_at * 1000).toISOString()
        : undefined,
    employmentType: text(type) || undefined,
    isRemote: true,
    workplaceType: "REMOTE",
    source: ARBEITNOW,
  };
}

// The newest remote postings, a couple of pages deep. The API has no keyword
// search, so the run's ranking does the filtering. A failure after the first
// page keeps what was fetched.
export async function fetchArbeitnowJobs(): Promise<
  ScraperResult<JobDetails[]>
> {
  const jobs: JobDetails[] = [];

  for (let page = 1; page <= APP_CONSTANTS.ARBEITNOW_MAX_PAGES; page++) {
    if (page > 1) await feedDelay();
    const params = new URLSearchParams({ remote: "true", page: String(page) });
    const result = await fetchFeedJson(
      `${APP_CONSTANTS.ARBEITNOW_API_URL}?${params}`,
      ARBEITNOW,
    );
    if (!result.success) {
      if (page === 1) return result;
      break;
    }

    const body = result.data as {
      data?: unknown;
      links?: { next?: unknown };
    } | null;
    if (!Array.isArray(body?.data)) {
      if (page === 1) {
        return {
          success: false,
          error: {
            type: "parse",
            message: `${ARBEITNOW} sent a malformed response`,
          },
        };
      }
      break;
    }

    for (const raw of body.data) {
      if (!raw || typeof raw !== "object") continue;
      const mapped = mapArbeitnowJob(raw as ArbeitnowJob);
      if (mapped) jobs.push(mapped);
    }
    if (body.data.length === 0 || !body.links?.next) break;
  }

  return { success: true, data: jobs };
}
