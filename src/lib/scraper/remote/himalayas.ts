import { APP_CONSTANTS } from "@/lib/constants";
import type { JobDetails, ScraperResult } from "../types";
import { feedDelay, fetchFeedJson, formatSalary, text } from "./http";

export const HIMALAYAS = "Himalayas";

interface HimalayasJob {
  title?: string;
  companyName?: string;
  employmentType?: string;
  locationRestrictions?: unknown;
  minSalary?: number | null;
  maxSalary?: number | null;
  currency?: string;
  salaryPeriod?: string;
  description?: string;
  excerpt?: string;
  pubDate?: number;
  applicationLink?: string;
  guid?: string;
}

// Countries a candidate must live in; none listed means open to everyone.
function locationOf(restrictions: unknown): string {
  if (!Array.isArray(restrictions)) return "Worldwide";
  const names = restrictions
    .map((entry) =>
      typeof entry === "string"
        ? entry
        : text((entry as { name?: unknown } | null)?.name),
    )
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length > 0 ? names.join(", ") : "Worldwide";
}

export function mapHimalayasJob(job: HimalayasJob): JobDetails | null {
  const title = text(job.title);
  // Himalayas asks that its apply link be used unchanged; the guid is the
  // posting's own URL and only a fallback.
  const url = text(job.applicationLink) || text(job.guid);
  if (!title || !/^https?:\/\//i.test(url)) return null;

  return {
    title,
    company: text(job.companyName) || "Unknown company",
    location: locationOf(job.locationRestrictions),
    description: text(job.description) || text(job.excerpt),
    url,
    postedDate:
      typeof job.pubDate === "number" && job.pubDate > 0
        ? new Date(job.pubDate * 1000).toISOString()
        : undefined,
    salary: formatSalary(
      job.minSalary,
      job.maxSalary,
      job.currency,
      job.salaryPeriod,
    ),
    employmentType: text(job.employmentType) || undefined,
    isRemote: true,
    workplaceType: "REMOTE",
    source: HIMALAYAS,
  };
}

function pageUrl(term: string | null, page: number, cursor?: string): string {
  if (term === null) {
    // No search terms: browse the newest postings instead (cursor-paged).
    const params = new URLSearchParams({
      limit: String(APP_CONSTANTS.HIMALAYAS_PAGE_SIZE),
    });
    if (cursor) params.set("cursor", cursor);
    return `${APP_CONSTANTS.HIMALAYAS_BROWSE_URL}?${params}`;
  }
  const params = new URLSearchParams({
    q: term,
    sort: "recent",
    page: String(page),
  });
  return `${APP_CONSTANTS.HIMALAYAS_SEARCH_URL}?${params}`;
}

// Searches each term for its newest postings, a couple of pages deep. Requests
// run one at a time: the keyless allowance is shared by every caller. A failure
// part-way keeps what was already fetched; only a first-request failure fails
// the feed.
export async function fetchHimalayasJobs(
  terms: string[],
): Promise<ScraperResult<JobDetails[]>> {
  const jobs: JobDetails[] = [];
  const queries: (string | null)[] = terms.length > 0 ? terms : [null];
  let requests = 0;

  for (const term of queries) {
    let cursor: string | undefined;
    for (let page = 1; page <= APP_CONSTANTS.HIMALAYAS_PAGES_PER_TERM; page++) {
      if (requests > 0) await feedDelay();
      const result = await fetchFeedJson(pageUrl(term, page, cursor), HIMALAYAS);
      requests++;

      if (!result.success) {
        if (jobs.length === 0 && requests === 1) return result;
        return { success: true, data: jobs };
      }

      const list = (result.data as { jobs?: unknown } | null)?.jobs;
      if (!Array.isArray(list)) {
        if (jobs.length === 0 && requests === 1) {
          return {
            success: false,
            error: {
              type: "parse",
              message: `${HIMALAYAS} sent a malformed response`,
            },
          };
        }
        return { success: true, data: jobs };
      }

      for (const raw of list) {
        const mapped = mapHimalayasJob(raw as HimalayasJob);
        if (mapped) jobs.push(mapped);
      }
      // A short page is the last one for this term.
      if (list.length < APP_CONSTANTS.HIMALAYAS_PAGE_SIZE) break;
      if (term === null) {
        cursor = text((result.data as { nextCursor?: unknown }).nextCursor);
        if (!cursor) break;
      }
    }
  }

  return { success: true, data: jobs };
}
