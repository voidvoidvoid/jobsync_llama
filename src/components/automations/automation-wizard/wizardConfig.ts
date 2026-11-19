import { APP_CONSTANTS } from "@/lib/constants";
import type { CreateAutomationInput } from "@/models/automation.schema";
import type { AtsConfigValue } from "../AtsSearchStep";

import { REMOTE_FEEDS, type JobBoard } from "@/models/automation.model";

export type AtsKey = JobBoard;

export const EMPTY_ATS: AtsConfigValue = {
  companies: [],
  targetTitles: [],
  keywords: [],
  locations: [],
  strictLocation: false,
  topK: APP_CONSTANTS.MAX_JOBS_PER_RUN,
  saveUnanalyzed: true,
};

// The remote board starts with its general-purpose feeds on: there is no list
// to build first. Regional feeds are left for the user to switch on.
export const EMPTY_REMOTE: AtsConfigValue = {
  ...EMPTY_ATS,
  companies: REMOTE_FEEDS.filter((feed) => feed.defaultOn).map(
    ({ name, token }) => ({ name, token }),
  ),
};

export function emptyConfigFor(board: JobBoard): AtsConfigValue {
  return board === "remote" ? EMPTY_REMOTE : EMPTY_ATS;
}

export const STEPS = [
  { id: "basics", title: "Basics", description: "Name your automation" },
  { id: "search", title: "Search", description: "Configure search criteria" },
  { id: "resume", title: "Resume", description: "Select resume for matching" },
  { id: "matching", title: "Matching", description: "Set match threshold" },
  { id: "schedule", title: "Schedule", description: "When to run" },
  { id: "review", title: "Review", description: "Confirm settings" },
];

// Step descriptions that differ for an AI Matching automation
export function stepDescription(step: number, jobBoard?: string): string {
  if (jobBoard === "ai-match") {
    if (step === 1) return "Choose which jobs to score";
    if (step === 2) return "Select a resume to match against";
    if (step === 3) return "Set the strong-match threshold";
  }
  return STEPS[step].description;
}

export const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${i.toString().padStart(2, "0")}:00`,
}));

export function parseEditSourceConfig(
  sc?: string | null,
): CreateAutomationInput["sourceConfig"] | undefined {
  if (!sc) return undefined;
  try {
    const parsed = JSON.parse(sc);
    return parsed?.greenhouse ||
      parsed?.lever ||
      parsed?.ashby ||
      parsed?.remote ||
      parsed?.["ai-match"]
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

export interface WizardResume {
  id: string;
  title: string;
  sectionCount: number;
}
