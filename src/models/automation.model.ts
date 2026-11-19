// Automation types and interfaces

export type AutomationStatus = "active" | "paused";
export type AutomationRunStatus =
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "completed_with_errors"
  | "blocked"
  | "rate_limited"
  | "cancelled";
export type DiscoveryStatus = "new" | "accepted" | "dismissed";
// Company job boards: one board per employer, picked from a directory.
export type AtsBoard = "greenhouse" | "lever" | "ashby";
// "remote" is the open search: public remote-job feeds queried by keyword,
// with no company list. "ai-match" is not a job board at all: it searches
// nothing, and scores jobs already saved that have no AI match yet.
export type SearchBoard = AtsBoard | "remote";
export type JobBoard = SearchBoard | "ai-match";

// Settings of an AI Matching automation (sourceConfig["ai-match"]).
export interface AiMatchConfig {
  // How many unmatched jobs one run scores at most
  maxJobs: number;
  // Score the most recently added jobs first (else the oldest first)
  newestFirst: boolean;
  // Listings saved by search automations without an AI analysis
  includeDiscovered: boolean;
  // Jobs in My Jobs that have no match score
  includeTracked: boolean;
  // "job": each job's own resume (its automation's, or the one linked to it),
  // falling back to this automation's; "automation": always this one's
  resumeSource: "job" | "automation";
}

export const AI_MATCH_MAX_JOBS = 200;

export const AI_MATCH_DEFAULTS: AiMatchConfig = {
  maxJobs: 20,
  newestFirst: true,
  includeDiscovered: true,
  includeTracked: true,
  resumeSource: "job",
};

// Tolerant read of a stored config: anything missing or out of range falls
// back to the default, so an older or hand-edited row still runs.
export function aiMatchConfig(raw?: Partial<AiMatchConfig> | null): AiMatchConfig {
  const max = Math.trunc(Number(raw?.maxJobs));
  return {
    maxJobs:
      max >= 1 ? Math.min(max, AI_MATCH_MAX_JOBS) : AI_MATCH_DEFAULTS.maxJobs,
    newestFirst:
      typeof raw?.newestFirst === "boolean"
        ? raw.newestFirst
        : AI_MATCH_DEFAULTS.newestFirst,
    includeDiscovered:
      typeof raw?.includeDiscovered === "boolean"
        ? raw.includeDiscovered
        : AI_MATCH_DEFAULTS.includeDiscovered,
    includeTracked:
      typeof raw?.includeTracked === "boolean"
        ? raw.includeTracked
        : AI_MATCH_DEFAULTS.includeTracked,
    resumeSource:
      raw?.resumeSource === "automation" ? "automation" : AI_MATCH_DEFAULTS.resumeSource,
  };
}

export function isAiMatchBoard(board: string): boolean {
  return board === "ai-match";
}

export interface GreenhouseCompany {
  name: string;
  token: string;
}

export type ExcludeScope = "all" | "title";

export interface GreenhouseSourceConfig {
  companies: GreenhouseCompany[];
  targetTitles?: string[];
  keywords?: string[];
  // A listing containing any of these words is dropped before ranking
  excludeKeywords?: string[];
  // Where to look for them: title and description (default) or title only
  excludeIn?: ExcludeScope;
  locations?: string[];
  strictLocation?: boolean;
  topK?: number;
  saveUnanalyzed?: boolean;
}

export type LeverHost = "default" | "eu";

export interface LeverCompany {
  name: string;
  token: string;
  host?: LeverHost; // absent/"default" = the common case
}

// Field-identical to Greenhouse except `companies` carries the extra `host`.
export interface LeverSourceConfig
  extends Omit<GreenhouseSourceConfig, "companies"> {
  companies: LeverCompany[];
}

// Ashby has a single global host, so its company entries are the plain
// {name, token} shape — no `host`, unlike Lever.
export interface AshbyCompany {
  name: string;
  token: string;
}

export interface AshbySourceConfig
  extends Omit<GreenhouseSourceConfig, "companies"> {
  companies: AshbyCompany[];
}

// A remote-job feed the "remote" board can read. Stored in the same
// `companies` slot the ATS boards use ({ name, token }), so per-feed failures,
// notifications and the run funnel all work unchanged.
export interface RemoteFeed {
  name: string;
  token: RemoteFeedId;
}

export type RemoteFeedId =
  | "himalayas"
  | "jobicy"
  | "remoteok"
  | "weworkremotely"
  | "workingnomads"
  | "arbeitnow"
  | "jsearch";

export type JSearchDatePosted = "today" | "3days" | "week" | "month" | "all";

// Per-automation JSearch settings. Every field is optional: an absent value
// means the default below, so saved automations never need migrating.
export interface JSearchOptions {
  remoteOnly?: boolean; // default true
  // 10 results a page; each page costs one request from the plan
  pagesPerTerm?: number; // default 1
  datePosted?: JSearchDatePosted; // default "week"
}

export const JSEARCH_DEFAULTS: Required<JSearchOptions> = {
  remoteOnly: true,
  pagesPerTerm: 1,
  datePosted: "week",
};

export const JSEARCH_MAX_PAGES_PER_TERM = 10;
export const JSEARCH_FREE_MONTHLY_REQUESTS = 200;

export function jsearchOptions(options?: JSearchOptions): Required<JSearchOptions> {
  const pages = Math.trunc(Number(options?.pagesPerTerm));
  return {
    remoteOnly:
      typeof options?.remoteOnly === "boolean"
        ? options.remoteOnly
        : JSEARCH_DEFAULTS.remoteOnly,
    pagesPerTerm:
      pages >= 1
        ? Math.min(pages, JSEARCH_MAX_PAGES_PER_TERM)
        : JSEARCH_DEFAULTS.pagesPerTerm,
    datePosted: options?.datePosted ?? JSEARCH_DEFAULTS.datePosted,
  };
}

export interface RemoteSourceConfig
  extends Omit<GreenhouseSourceConfig, "companies"> {
  companies: RemoteFeed[];
  jsearch?: JSearchOptions;
}

// `url` is the feed's public site: the link shown beside its name, which also
// credits it as the source of the listings. `defaultOn` is whether a new
// remote automation starts with the feed switched on.
export const REMOTE_FEEDS: {
  token: RemoteFeedId;
  name: string;
  url: string;
  blurb: string;
  defaultOn: boolean;
  // Needs the user's own API key (Settings → API Keys)
  requiresKey?: boolean;
}[] = [
  {
    token: "himalayas",
    name: "Himalayas",
    url: "https://himalayas.app/jobs",
    blurb: "Largest feed. Searched with your titles and keywords.",
    defaultOn: true,
  },
  {
    token: "jobicy",
    name: "Jobicy",
    url: "https://jobicy.com",
    blurb: "Curated remote roles. Searched with your first few terms.",
    defaultOn: true,
  },
  {
    token: "remoteok",
    name: "Remote OK",
    url: "https://remoteok.com",
    blurb: "The newest 100 postings, filtered here by your terms.",
    defaultOn: true,
  },
  {
    token: "weworkremotely",
    name: "We Work Remotely",
    url: "https://weworkremotely.com",
    blurb: "The newest postings from its public feed, filtered here.",
    defaultOn: true,
  },
  {
    token: "workingnomads",
    name: "Working Nomads",
    url: "https://www.workingnomads.com/jobs",
    blurb: "Its whole current list in one download, filtered here.",
    defaultOn: true,
  },
  {
    token: "arbeitnow",
    name: "Arbeitnow",
    url: "https://www.arbeitnow.com",
    blurb:
      "Europe-focused, largely Germany, and many listings are in German. Its newest remote roles, filtered here.",
    defaultOn: false,
  },
  {
    token: "jsearch",
    name: "JSearch",
    url: "https://www.openwebninja.com/api/jsearch",
    blurb:
      "LinkedIn, Indeed, Glassdoor and more, through Google for Jobs. Searched with your titles and keywords. Needs a JSearch API key (free plan available).",
    defaultOn: false,
    requiresKey: true,
  },
];

export interface SourceConfig {
  greenhouse?: GreenhouseSourceConfig;
  lever?: LeverSourceConfig;
  ashby?: AshbySourceConfig;
  remote?: RemoteSourceConfig;
  "ai-match"?: AiMatchConfig;
}

// Plain, dependency-free board list. Do NOT import this from ats/registry.ts
// (that pulls the network-calling search fns into client bundles). Both the
// client-imported schema and the scheduler import it here.
export const ATS_BOARDS: AtsBoard[] = ["greenhouse", "lever", "ashby"];

// Every automation type that runs (what the scheduler picks up).
export const JOB_BOARDS: JobBoard[] = [...ATS_BOARDS, "remote", "ai-match"];

export const JOB_BOARD_LABELS: Record<JobBoard, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  remote: "Remote job boards",
  "ai-match": "AI Matching",
};

// Display name for a stored jobBoard value, including retired ones.
export function jobBoardLabel(board: string): string {
  return (
    JOB_BOARD_LABELS[board as JobBoard] ??
    board.charAt(0).toUpperCase() + board.slice(1)
  );
}

export function isRemoteBoard(board: string): boolean {
  return board === "remote";
}

// The remote board's provider label, as stored in "board" notifications. The
// notification list keys its wording on it (a feed is not a company's board).
export const REMOTE_PROVIDER_LABEL = "Remote boards";

// Boards that used to exist and were removed. Their Automation rows stay in
// the database; the UI marks them retired and only offers pause/delete.
export const RETIRED_BOARDS = ["jsearch"];
export function isRetiredBoard(board: string): boolean {
  return RETIRED_BOARDS.includes(board);
}

export interface Automation {
  id: string;
  userId: string;
  name: string;
  jobBoard: JobBoard;
  keywords: string;
  location: string;
  sourceConfig?: string | null;
  resumeId: string;
  matchThreshold: number;
  scheduleHour: number;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  status: AutomationStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutomationWithResume extends Automation {
  resume: {
    id: string;
    title: string;
  };
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  jobsSearched: number;
  jobsDeduplicated: number;
  jobsProcessed: number;
  jobsMatched: number;
  jobsSaved: number;
  status: AutomationRunStatus;
  errorMessage: string | null;
  blockedReason: string | null;
  funnelStats: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface DiscoveredJob {
  id: string;
  userId: string;
  automationId: string;
  automation?: {
    id: string;
    name: string;
  };
  jobUrl: string | null;
  description: string;
  jobType: string;
  workplaceType?: string | null;
  createdAt: Date;
  jobTitleId: string;
  companyId: string;
  locationId: string | null;
  matchScore: number;
  matchData: string | null;
  discoveryStatus: DiscoveryStatus;
  discoveredAt: Date;
  JobTitle: { label: string };
  Company: { label: string };
  Location?: { label: string } | null;
}

export interface ScrapedJobData {
  title: string;
  company: string;
  location: string;
  description: string;
  sourceUrl: string;
  // A job board id, or the feed name ("Himalayas") for remote-feed listings
  sourceBoard: string;
  employmentType?: string;
  isRemote?: boolean;
  workplaceType?: string;
}
