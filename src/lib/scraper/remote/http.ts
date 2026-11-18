import { APP_CONSTANTS } from "@/lib/constants";
import type { ScraperResult } from "../types";

// One GET against a feed, with a timeout and an honest User-Agent (Remote OK
// turns away anonymous clients). 429 is kept distinct so a run reports
// "rate limited" rather than a bare network error.
export async function fetchFeedJson(
  url: string,
  feed: string,
): Promise<ScraperResult<unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    APP_CONSTANTS.REMOTE_FEED_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": APP_CONSTANTS.REMOTE_FEED_USER_AGENT,
      },
    });

    if (response.status === 429) {
      return { success: false, error: { type: "rate_limited" } };
    }
    if (!response.ok) {
      return {
        success: false,
        error: {
          type: "network",
          message: `${feed} returned ${response.status}`,
        },
      };
    }

    try {
      return { success: true, data: await response.json() };
    } catch {
      return {
        success: false,
        error: { type: "parse", message: `${feed} sent a malformed response` },
      };
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        error: { type: "network", message: `${feed} timed out` },
      };
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: { type: "network", message } };
  } finally {
    clearTimeout(timer);
  }
}

export function feedDelay(): Promise<void> {
  const ms = APP_CONSTANTS.REMOTE_FEED_REQUEST_DELAY_MS;
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

// "90000–125000 USD / yearly"; undefined when the feed gave no usable figure.
export function formatSalary(
  min: unknown,
  max: unknown,
  currency?: unknown,
  period?: unknown,
): string | undefined {
  const lo = typeof min === "number" && min > 0 ? min : null;
  const hi = typeof max === "number" && max > 0 ? max : null;
  if (lo === null && hi === null) return undefined;
  const range = lo !== null && hi !== null && lo !== hi ? `${lo}–${hi}` : `${lo ?? hi}`;
  const unit = typeof currency === "string" && currency ? ` ${currency}` : "";
  const per = typeof period === "string" && period ? ` / ${period}` : "";
  return `${range}${unit}${per}`;
}

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
