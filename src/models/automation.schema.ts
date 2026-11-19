import { z } from "zod";
import { APP_CONSTANTS } from "@/lib/constants";
// Deep-import (NOT the barrel) — utils.ts is pure; the barrel pulls scraper
// network code into the client bundle via this file's client consumers.
import { ATS_TOKEN_REGEX } from "@/lib/scraper/utils";

export const JobBoardSchema = z.enum([
  "greenhouse",
  "lever",
  "ashby",
  "remote",
  "ai-match",
]);

export const AutomationStatusSchema = z.enum(["active", "paused"]);

export const AutomationRunStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "completed_with_errors",
  "blocked",
  "rate_limited",
]);

export const DiscoveryStatusSchema = z.enum(["new", "accepted", "dismissed"]);

export const GreenhouseCompanySchema = z.object({
  name: z.string().min(1).max(200),
  token: z.string().min(1).max(80),
});

export const GreenhouseSourceConfigSchema = z.object({
  companies: z
    .array(GreenhouseCompanySchema)
    .max(APP_CONSTANTS.ATS_MAX_COMPANIES),
  targetTitles: z.array(z.string().min(1).max(100)).optional(),
  keywords: z.array(z.string().min(1).max(100)).optional(),
  locations: z.array(z.string().min(1).max(100)).optional(),
  strictLocation: z.boolean().optional(),
  topK: z.number().int().min(1).max(APP_CONSTANTS.ATS_LISTING_CAP).optional(),
  saveUnanalyzed: z.boolean().optional(),
});

// Override `token` with the allowlist regex so a directly-POSTed Lever config
// can't smuggle a malformed token past the save boundary.
export const LeverCompanySchema = GreenhouseCompanySchema.extend({
  token: z.string().regex(ATS_TOKEN_REGEX),
  host: z.enum(["default", "eu"]).optional(),
});

// Same fields/MAX/cap as Greenhouse, `companies` swapped to LeverCompanySchema.
export const LeverSourceConfigSchema = GreenhouseSourceConfigSchema.extend({
  companies: z
    .array(LeverCompanySchema)
    .max(APP_CONSTANTS.ATS_MAX_COMPANIES),
});

// Same token allowlist as Lever (rejects path/query injection at the save
// boundary); no `host` — Ashby is single-host.
export const AshbyCompanySchema = GreenhouseCompanySchema.extend({
  token: z.string().regex(ATS_TOKEN_REGEX),
});

export const AshbySourceConfigSchema = GreenhouseSourceConfigSchema.extend({
  companies: z
    .array(AshbyCompanySchema)
    .max(APP_CONSTANTS.ATS_MAX_COMPANIES),
});

// The remote board's "companies" are the feeds to read; only known feed ids
// are accepted, so a saved config can never point the fetcher elsewhere.
export const RemoteFeedSchema = z.object({
  name: z.string().min(1).max(200),
  token: z.enum([
    "himalayas",
    "jobicy",
    "remoteok",
    "weworkremotely",
    "workingnomads",
    "arbeitnow",
    "jsearch",
  ]),
});

export const JSearchOptionsSchema = z.object({
  remoteOnly: z.boolean().optional(),
  pagesPerTerm: z.number().int().min(1).max(10).optional(),
  datePosted: z.enum(["today", "3days", "week", "month", "all"]).optional(),
});

export const RemoteSourceConfigSchema = GreenhouseSourceConfigSchema.extend({
  companies: z.array(RemoteFeedSchema).max(7),
  jsearch: JSearchOptionsSchema.optional(),
});

export const AiMatchConfigSchema = z.object({
  maxJobs: z.number().int().min(1).max(200),
  newestFirst: z.boolean(),
  includeDiscovered: z.boolean(),
  includeTracked: z.boolean(),
  resumeSource: z.enum(["job", "automation"]),
});

export const SourceConfigSchema = z.object({
  greenhouse: GreenhouseSourceConfigSchema.optional(),
  lever: LeverSourceConfigSchema.optional(),
  ashby: AshbySourceConfigSchema.optional(),
  remote: RemoteSourceConfigSchema.optional(),
  "ai-match": AiMatchConfigSchema.optional(),
});

// An AI Matching automation has no companies or job boards: it needs only
// something to score.
function checkSource(
  data: { jobBoard?: string; sourceConfig?: z.infer<typeof SourceConfigSchema> },
  ctx: z.RefinementCtx,
) {
  if (!data.jobBoard) return;
  if (data.jobBoard === "ai-match") {
    const cfg = data.sourceConfig?.["ai-match"];
    if (!cfg || (!cfg.includeDiscovered && !cfg.includeTracked)) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceConfig", "ai-match"],
        message: "Choose at least one kind of job to score",
      });
    }
    return;
  }
  const configs = data.sourceConfig as
    | Record<string, { companies?: unknown[] } | undefined>
    | undefined;
  const companies = configs?.[data.jobBoard]?.companies ?? [];
  if (companies.length < 1) {
    ctx.addIssue({
      code: "custom",
      path: ["sourceConfig", data.jobBoard, "companies"],
      message: noSourceMessage(data.jobBoard),
    });
  }
}

const noSourceMessage = (jobBoard: string) =>
  jobBoard === "remote"
    ? "Select at least one job board"
    : "Select at least one company";

// Only a malformed id gets the custom text; a missing one keeps Zod's own.
const invalidResume = (issue: { code: string }) =>
  issue.code === "invalid_format" ? "Invalid resume" : undefined;

export const CreateAutomationSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(100),
    jobBoard: JobBoardSchema,
    keywords: z.string().max(200).optional(),
    location: z.string().max(100).optional(),
    sourceConfig: SourceConfigSchema.optional(),
    resumeId: z.uuid({ error: invalidResume }),
    matchThreshold: z.number().min(0).max(100),
    scheduleHour: z.number().min(0).max(23),
  })
  .superRefine(checkSource);

export const UpdateAutomationSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    jobBoard: JobBoardSchema.optional(),
    keywords: z.string().max(200).optional(),
    location: z.string().max(100).optional(),
    sourceConfig: SourceConfigSchema.optional(),
    resumeId: z.uuid({ error: invalidResume }).optional(),
    matchThreshold: z.number().min(0).max(100).optional(),
    scheduleHour: z.number().min(0).max(23).optional(),
  })
  .superRefine(checkSource);

export type CreateAutomationInput = z.infer<typeof CreateAutomationSchema>;
export type UpdateAutomationInput = z.infer<typeof UpdateAutomationSchema>;
export type SourceConfigInput = z.infer<typeof SourceConfigSchema>;
export type GreenhouseSourceConfigInput = z.infer<
  typeof GreenhouseSourceConfigSchema
>;
