export interface JobDetails {
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  postedDate?: string;
  salary?: string;
  employmentType?: string;
  isRemote?: boolean;
  workplaceType?: string;
  // Short form of `location` to save on the job when the full one is a long
  // list that only the location filter needs ("Multiple countries").
  locationLabel?: string;
  // Where the listing came from when one board reads several feeds
  // ("Himalayas"). Saved as the job's source in place of the board id.
  source?: string;
}

export type ScraperError =
  | { type: "blocked"; reason: string }
  | { type: "rate_limited"; retryAfter?: number }
  | { type: "network"; message: string }
  | { type: "parse"; message: string };

export type ScraperResult<T> =
  | { success: true; data: T }
  | { success: false; error: ScraperError };
