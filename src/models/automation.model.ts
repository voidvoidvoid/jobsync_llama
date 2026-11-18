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
// with no company list.
export type JobBoard = AtsBoard | "remote";

export interface GreenhouseCompany {
  name: string;
  token: string;
}

export interface GreenhouseSourceConfig {
  companies: GreenhouseCompany[];
  targetTitles?: string[];
  keywords?: string[];
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

export type RemoteFeedId = "himalayas" | "jobicy" | "remoteok";

export interface RemoteSourceConfig
  extends Omit<GreenhouseSourceConfig, "companies"> {
  companies: RemoteFeed[];
}

// `url` is the feed's public site: the link shown beside its name, which also
// credits it as the source of the listings.
export const REMOTE_FEEDS: {
  token: RemoteFeedId;
  name: string;
  url: string;
  blurb: string;
}[] = [
  {
    token: "himalayas",
    name: "Himalayas",
    url: "https://himalayas.app/jobs",
    blurb: "Largest feed. Searched with your titles and keywords.",
  },
  {
    token: "jobicy",
    name: "Jobicy",
    url: "https://jobicy.com",
    blurb: "Curated remote roles. Searched with your first few terms.",
  },
  {
    token: "remoteok",
    name: "Remote OK",
    url: "https://remoteok.com",
    blurb: "The newest 100 postings, filtered here by your terms.",
  },
];

export interface SourceConfig {
  greenhouse?: GreenhouseSourceConfig;
  lever?: LeverSourceConfig;
  ashby?: AshbySourceConfig;
  remote?: RemoteSourceConfig;
}

// Plain, dependency-free board list. Do NOT import this from ats/registry.ts
// (that pulls the network-calling search fns into client bundles). Both the
// client-imported schema and the scheduler import it here.
export const ATS_BOARDS: AtsBoard[] = ["greenhouse", "lever", "ashby"];

// Every board an automation can run on (what the scheduler picks up).
export const JOB_BOARDS: JobBoard[] = [...ATS_BOARDS, "remote"];

export const JOB_BOARD_LABELS: Record<JobBoard, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  remote: "Remote job boards",
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
