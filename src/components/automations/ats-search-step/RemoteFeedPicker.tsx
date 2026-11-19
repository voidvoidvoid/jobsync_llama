"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getUserApiKeys } from "@/actions/apiKey.actions";
import { buildSearchTerms } from "@/lib/scraper/remote/terms";
import {
  JSEARCH_FREE_MONTHLY_REQUESTS,
  REMOTE_FEEDS,
  jsearchOptions,
  type JSearchDatePosted,
  type JSearchOptions,
} from "@/models/automation.model";
import type { AtsConfigValue } from "./types";

interface RemoteFeedPickerProps {
  value: AtsConfigValue;
  onChange: (next: AtsConfigValue) => void;
}

const RESULTS_PER_TERM = [1, 2, 3, 5, 10]; // pages of 10

const DATE_POSTED: { value: JSearchDatePosted; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "3days", label: "Last 3 days" },
  { value: "week", label: "Last week" },
  { value: "month", label: "Last month" },
  { value: "all", label: "Any time" },
];

// The remote board's stand-in for the company picker: which public remote-job
// feeds to read. Each is credited by name and linked to its own site.
export function RemoteFeedPicker({ value, onChange }: RemoteFeedPickerProps) {
  const feeds = value.companies ?? [];
  const selected = new Set(feeds.map((f) => f.token));

  const toggle = (token: string, on: boolean) => {
    // Rebuilt from REMOTE_FEEDS so the saved order and names stay canonical.
    const companies = REMOTE_FEEDS.filter((feed) =>
      feed.token === token ? on : selected.has(feed.token),
    ).map(({ name, token: id }) => ({ name, token: id }));
    onChange({ ...value, companies });
  };

  return (
    <div className="space-y-2">
      <Label>Job boards</Label>
      <p className="text-sm text-muted-foreground">
        Every listing on these boards is a remote role. No company list is
        needed: they are searched with the titles and keywords below.
      </p>
      <div className="rounded-lg border divide-y">
        {REMOTE_FEEDS.map((feed) => (
          <div key={feed.token} className="p-3 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor={`feed-${feed.token}`}>{feed.name}</Label>
                  <a
                    href={feed.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open ${feed.name}`}
                    title={`Open ${feed.name}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                <p className="text-sm text-muted-foreground">{feed.blurb}</p>
              </div>
              <Switch
                id={`feed-${feed.token}`}
                checked={selected.has(feed.token)}
                onCheckedChange={(checked) => toggle(feed.token, checked)}
              />
            </div>
            {feed.token === "jsearch" && selected.has("jsearch") && (
              <JSearchSettings value={value} onChange={onChange} />
            )}
          </div>
        ))}
      </div>
      {selected.size === 0 && (
        <p className="text-sm text-destructive">
          Turn on at least one job board.
        </p>
      )}
    </div>
  );
}

function JSearchSettings({ value, onChange }: RemoteFeedPickerProps) {
  const options = jsearchOptions(value.jsearch);
  const update = (patch: JSearchOptions) =>
    onChange({ ...value, jsearch: { ...options, ...patch } });

  // Only keys saved in the app are visible here; one set on the server
  // (JSEARCH_API_KEY) is not, so the notice says "no saved key", not "no key".
  const [hasSavedKey, setHasSavedKey] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    getUserApiKeys()
      .then((result) => {
        if (!live) return;
        const keys = result?.success ? (result.data ?? []) : [];
        setHasSavedKey(
          keys.some((k: { provider: string }) =>
            k.provider === "jsearch" || k.provider === "jsearch-rapidapi",
          ),
        );
      })
      .catch(() => live && setHasSavedKey(null));
    return () => {
      live = false;
    };
  }, []);

  const terms = buildSearchTerms({
    targetTitles: value.targetTitles ?? [],
    keywords: value.keywords ?? [],
  }).length;
  const perRun = terms * options.pagesPerTerm;
  const perMonth = perRun * 30;

  return (
    <div className="ml-1 space-y-3 border-l-2 pl-4">
      {hasSavedKey === false && (
        <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-500">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            No JSearch key is saved. Add one under{" "}
            <Link
              href="/dashboard/settings?section=api-keys"
              className="underline"
            >
              Settings → API Keys
            </Link>{" "}
            (unless the server sets JSEARCH_API_KEY), or this board will fail
            each run.
          </span>
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="jsearch-remote-only">Remote roles only</Label>
          <p className="text-sm text-muted-foreground">
            JSearch covers every kind of role. When off, on-site and hybrid
            roles come through too.
          </p>
        </div>
        <Switch
          id="jsearch-remote-only"
          checked={options.remoteOnly}
          onCheckedChange={(checked) => update({ remoteOnly: checked })}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="jsearch-results">Results per search term</Label>
          <Select
            value={String(options.pagesPerTerm)}
            onValueChange={(v) => update({ pagesPerTerm: Number(v) })}
          >
            <SelectTrigger id="jsearch-results" aria-label="Results per search term">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESULTS_PER_TERM.map((pages) => (
                <SelectItem key={pages} value={String(pages)}>
                  Up to {pages * 10} ({pages} {pages === 1 ? "request" : "requests"})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="jsearch-posted">Posted within</Label>
          <Select
            value={options.datePosted}
            onValueChange={(v) => update({ datePosted: v as JSearchDatePosted })}
          >
            <SelectTrigger id="jsearch-posted" aria-label="Posted within">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_POSTED.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p
        className={`text-sm ${
          perMonth > JSEARCH_FREE_MONTHLY_REQUESTS
            ? "text-amber-600 dark:text-amber-500"
            : "text-muted-foreground"
        }`}
        data-testid="jsearch-usage"
      >
        {terms === 0
          ? "Add a job title or keyword below: JSearch only runs searches."
          : `Each run uses ${perRun} ${perRun === 1 ? "request" : "requests"} (${terms} ${terms === 1 ? "search term" : "search terms"} × ${options.pagesPerTerm}), about ${perMonth} a month on the daily schedule. The free plan allows ${JSEARCH_FREE_MONTHLY_REQUESTS} a month${perMonth > JSEARCH_FREE_MONTHLY_REQUESTS ? ", so this needs a paid plan" : ""}. Manual runs count too.`}
      </p>
    </div>
  );
}
