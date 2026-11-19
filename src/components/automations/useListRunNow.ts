"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toastError, toastSuccess } from "@/lib/toast";
import { getAutomationRuns } from "@/actions/automation.actions";
import { useNotifications } from "@/context/NotificationContext";

const POLL_MS = 3000;
// A run with a local model can take a while; stop watching (not the run)
// after this, and leave the rest to the automation's own page.
const MAX_WATCH_MS = 60 * 60 * 1000;

type Watch = {
  // The latest run before ours, when it had already finished. null means a run
  // was in flight when we started (ours, or one the 409 told us about): follow
  // the latest run until it finishes, whatever its id.
  prevRunId: string | null;
  name: string;
  startedAt: number;
};

// "Run now" for the automations list: starts the same background run as the
// automation page's Run Now button, then watches its run record and reports
// the result. Several automations can be followed at once.
export function useListRunNow(onFinished: () => void) {
  const [starting, setStarting] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState<Set<string>>(new Set());
  const watches = useRef(new Map<string, Watch>());
  const { refresh: refreshNotifications } = useNotifications();

  const setIn = (
    set: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
    on: boolean,
  ) =>
    set((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const stopWatching = useCallback((id: string) => {
    watches.current.delete(id);
    setIn(setRunning, id, false);
  }, []);

  const runNow = useCallback(async (id: string, name: string) => {
    setIn(setStarting, id, true);
    try {
      // Note the latest run first, so the new run can be told apart from it
      const before = await getAutomationRuns(id, { limit: 1 });
      const latest = before.success ? before.data?.[0] : undefined;
      const prevRunId =
        latest && latest.status !== "running" && latest.status !== "cancelling"
          ? latest.id
          : null;

      const response = await fetch(`/api/automations/${id}/run`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok && data.success) {
        watches.current.set(id, { prevRunId, name, startedAt: Date.now() });
        setIn(setRunning, id, true);
        toastSuccess(
          "You can leave this page; the run carries on.",
          `Running “${name}”`,
        );
      } else if (response.status === 409) {
        // Already running (the schedule, another tab): follow that run instead
        watches.current.set(id, {
          prevRunId: null,
          name,
          startedAt: Date.now(),
        });
        setIn(setRunning, id, true);
        toastError(
          data.message || "This automation is already running.",
          "Already running",
        );
      } else {
        toastError(
          data.message || "Failed to start run",
          `Could not run “${name}”`,
        );
      }
    } catch {
      toastError("Failed to start run", `Could not run “${name}”`);
    } finally {
      setIn(setStarting, id, false);
    }
  }, []);

  const hasWatches = running.size > 0;
  useEffect(() => {
    if (!hasWatches) return;
    let busy = false;

    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        for (const [id, watch] of [...watches.current]) {
          if (Date.now() - watch.startedAt > MAX_WATCH_MS) {
            stopWatching(id);
            continue;
          }
          const res = await getAutomationRuns(id, { limit: 1 });
          if (!watches.current.has(id) || !res.success) continue;
          const latest = res.data?.[0];
          if (!latest) continue;
          if (watch.prevRunId && latest.id === watch.prevRunId) continue;
          if (latest.status === "running" || latest.status === "cancelling")
            continue;

          stopWatching(id);
          // finalizeRun writes notifications before the run row turns terminal
          refreshNotifications();
          const saved = `Saved ${latest.jobsSaved} new ${latest.jobsSaved === 1 ? "job" : "jobs"}`;
          if (latest.status === "completed") {
            toastSuccess(saved, `“${watch.name}” finished`);
          } else if (latest.status === "completed_with_errors") {
            toastSuccess(
              `${saved}. Some job boards failed; see notifications.`,
              `“${watch.name}” finished with errors`,
            );
          } else if (latest.status === "cancelled") {
            toastError(saved, `“${watch.name}” cancelled`);
          } else {
            // failed, blocked, rate_limited
            toastError(
              "Open the automation to see what went wrong.",
              `“${watch.name}” did not finish`,
            );
          }
          onFinished();
        }
      } finally {
        busy = false;
      }
    };

    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, [hasWatches, onFinished, refreshNotifications, stopWatching]);

  return {
    runNow,
    isStarting: (id: string) => starting.has(id),
    isRunning: (id: string) => running.has(id),
  };
}
