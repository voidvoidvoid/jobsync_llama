"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  aiMatchConfig,
  jsearchOptions,
  type JSearchOptions,
  isRemoteBoard,
  type JobBoard,
  type LeverSourceConfig,
} from "@/models/automation.model";
import { companyBoardUrl } from "@/lib/atsBoardUrl";
import { APP_CONSTANTS } from "@/lib/constants";

// Pure JSON parse (no runner dependency — this is a client component, and
// runner.ts pulls the network-calling scraper into the client bundle). The raw
// parse may be missing any field, so it's a Partial of the config shape.
function parseAtsConfig(
  sourceConfig: string | null | undefined,
  jobBoard: JobBoard,
): (Partial<LeverSourceConfig> & { jsearch?: JSearchOptions }) | null {
  if (!sourceConfig) return null;
  try {
    return JSON.parse(sourceConfig)?.[jobBoard] ?? null;
  } catch {
    return null;
  }
}

interface AutomationSearchConfigProps {
  sourceConfig: string | null | undefined;
  jobBoard: JobBoard;
  retired: boolean;
}

export function AutomationSearchConfig({
  sourceConfig,
  jobBoard,
  retired,
}: AutomationSearchConfigProps) {
  const [showSearchConfig, setShowSearchConfig] = useState(false);

  const greenhouseConfig = retired
    ? null
    : parseAtsConfig(sourceConfig, jobBoard);

  if (!retired && jobBoard === "ai-match") {
    let stored = null;
    try {
      stored = JSON.parse(sourceConfig ?? "{}")?.["ai-match"] ?? null;
    } catch {}
    const m = aiMatchConfig(stored);
    const rows: [string, string][] = [
      [
        "Scores",
        [
          m.includeDiscovered && "Listings from search automations",
          m.includeTracked && "My Jobs with no score",
        ]
          .filter(Boolean)
          .join(", "),
      ],
      ["Jobs per run", `Up to ${m.maxJobs}`],
      ["Order", m.newestFirst ? "Newest first" : "Oldest first"],
      [
        "Resume",
        m.resumeSource === "job"
          ? "Each job's own, else this automation's"
          : "Always this automation's",
      ],
    ];
    return (
      <div className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-4 gap-4">
        {rows.map(([label, value]) => (
          <div key={label}>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-sm font-medium">{value}</p>
          </div>
        ))}
      </div>
    );
  }

  if (!greenhouseConfig) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="mt-4 -ml-2 text-muted-foreground"
        onClick={() => setShowSearchConfig((prev) => !prev)}
      >
        {showSearchConfig ? (
          <ChevronUp className="h-4 w-4 mr-1" />
        ) : (
          <ChevronDown className="h-4 w-4 mr-1" />
        )}
        {showSearchConfig ? "Show less" : "Show more"}
      </Button>

      {showSearchConfig && (
        <div className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="col-span-2 md:col-span-4">
            <p className="text-sm text-muted-foreground">
              {isRemoteBoard(jobBoard) ? "Job boards" : "Companies"}
            </p>
            {greenhouseConfig.companies?.length ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {greenhouseConfig.companies.map((c) => (
                  <Badge key={c.token} variant="secondary" className="gap-1">
                    {c.name}
                    <a
                      href={companyBoardUrl(jobBoard, c)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={
                        isRemoteBoard(jobBoard)
                          ? `Open ${c.name}`
                          : `Open ${c.name} job board`
                      }
                      title={isRemoteBoard(jobBoard) ? `Open ${c.name}` : "Open job board"}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm font-medium">-</p>
            )}
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Target titles</p>
            <p className="text-sm font-medium">
              {greenhouseConfig.targetTitles?.length
                ? greenhouseConfig.targetTitles.join(", ")
                : "Any"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Keywords</p>
            <p className="text-sm font-medium">
              {greenhouseConfig.keywords?.length
                ? greenhouseConfig.keywords.join(", ")
                : "None"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Excluding</p>
            <p className="text-sm font-medium">
              {greenhouseConfig.excludeKeywords?.length
                ? `${greenhouseConfig.excludeKeywords.join(", ")}${
                    greenhouseConfig.excludeIn === "title" ? " (title only)" : ""
                  }`
                : "None"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Locations</p>
            <p className="text-sm font-medium">
              {greenhouseConfig.locations?.length
                ? `${greenhouseConfig.locations.join(", ")}${
                    greenhouseConfig.strictLocation ? " (strict)" : ""
                  }`
                : "Any location"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">
              Jobs analyzed per run
            </p>
            <p className="text-sm font-medium">
              {greenhouseConfig.topK ?? APP_CONSTANTS.MAX_JOBS_PER_RUN}
            </p>
          </div>
          {greenhouseConfig.companies?.some((c) => c.token === "jsearch") && (
            <div className="col-span-2">
              <p className="text-sm text-muted-foreground">JSearch</p>
              <p className="text-sm font-medium">
                {(() => {
                  const o = jsearchOptions(greenhouseConfig.jsearch);
                  const posted: Record<string, string> = {
                    today: "today",
                    "3days": "last 3 days",
                    week: "last week",
                    month: "last month",
                    all: "any time",
                  };
                  return `${o.remoteOnly ? "Remote only" : "All work types"} · up to ${o.pagesPerTerm * 10} per term · posted ${posted[o.datePosted]}`;
                })()}
              </p>
            </div>
          )}
          <div>
            <p className="text-sm text-muted-foreground">Extra listings</p>
            <p className="text-sm font-medium">
              {greenhouseConfig.saveUnanalyzed !== false
                ? "Saved"
                : "Not saved"}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
