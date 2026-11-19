export type NotificationKind = "run" | "error" | "board";

export type BoardErrorCode =
  | "not_found"
  | "timeout"
  | "rate_limited"
  | "http_error"
  | "parse"
  | "network"
  | "auth";

export interface RunPayload {
  status: "completed" | "completed_with_errors";
  jobsSearched: number;
  jobsSaved: number;
  belowThreshold: number;
  boardsFailed: number;
  aiError: string | null;
  // Set for an AI Matching run, which scores saved jobs instead of saving new ones
  aiMatch?: { scored: number; strong: number; failed: number; left: number };
}

export interface BoardFailurePayload {
  token: string;
  companyName: string;
  code: BoardErrorCode;
  reason: string;
}

export interface ErrorPayload {
  reason: string;
  jobsSaved: number;
  boards: BoardFailurePayload[]; // non-empty only when every board failed
  // Set for an AI Matching run: how many jobs it scored before stopping
  jobsScored?: number;
}

export interface BoardPayload extends BoardFailurePayload {
  provider: string; // display label, e.g. "Greenhouse"
}

export type NotificationTab = "all" | "unread" | "errors" | "runs";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  payload: RunPayload | ErrorPayload | BoardPayload;
  occurrences: number;
  occurredAt: Date;
  createdAt: Date;
  readAt: Date | null;
  dismissedAt: Date | null;
  automation: { id: string; name: string };
}

export interface NotificationSummary {
  unread: number;
  unreadErrors: number;
}
