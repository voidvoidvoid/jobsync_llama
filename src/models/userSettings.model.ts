import { AiProvider } from "./ai.model";
import type { GoalTargetsByMonth } from "./dailyGoals.model";

export interface AiSettings {
  provider: AiProvider;
  model: string | undefined;
}

export interface DisplaySettings {
  theme: "light" | "dark" | "system";
}

export interface GoalSettings {
  targets: GoalTargetsByMonth;
}

// Phrases the AI match checks every job description for. A hit is flagged on
// the match and, when withdraw is on, moves a not-yet-applied job to
// Withdrawn.
export interface DealBreakerSettings {
  items: string[];
  withdraw: boolean;
}

export const DEAL_BREAKER_LIMITS = {
  maxItems: 25,
  maxLength: 80,
} as const;

export const defaultDealBreakerSettings: DealBreakerSettings = {
  items: [],
  withdraw: true,
};

// Trims, de-duplicates (case-insensitively) and caps the list so the prompt
// stays small and a pasted paragraph cannot crowd out the job description.
export function normalizeDealBreakers(
  input: Partial<DealBreakerSettings> | undefined,
): DealBreakerSettings {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of input?.items ?? []) {
    if (typeof raw !== "string") continue;
    const item = raw.replace(/\s+/g, " ").trim().slice(0, DEAL_BREAKER_LIMITS.maxLength);
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= DEAL_BREAKER_LIMITS.maxItems) break;
  }
  return {
    items,
    withdraw:
      typeof input?.withdraw === "boolean"
        ? input.withdraw
        : defaultDealBreakerSettings.withdraw,
  };
}

export interface UserSettingsData {
  ai: AiSettings;
  display: DisplaySettings;
  goals?: GoalSettings;
  dealBreakers?: DealBreakerSettings;
}

export interface UserSettings {
  userId: string;
  settings: UserSettingsData;
}

export const defaultUserSettings: UserSettingsData = {
  ai: {
    provider: AiProvider.OLLAMA,
    model: undefined,
  },
  display: {
    theme: "system",
  },
};
