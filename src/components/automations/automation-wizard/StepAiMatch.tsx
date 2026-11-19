"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { countUnmatchedJobs } from "@/actions/automation.actions";
import {
  AI_MATCH_MAX_JOBS,
  type AiMatchConfig,
} from "@/models/automation.model";

interface StepAiMatchProps {
  value: AiMatchConfig;
  onChange: (next: AiMatchConfig) => void;
}

// What an AI Matching automation scores, and in what order. Stands in for the
// Search step of the search automations.
export function StepAiMatch({ value, onChange }: StepAiMatchProps) {
  const update = (patch: Partial<AiMatchConfig>) =>
    onChange({ ...value, ...patch });

  // The text box is edited freely; the saved number is always 1..max
  const [maxText, setMaxText] = useState(String(value.maxJobs));
  const [prevMax, setPrevMax] = useState(value.maxJobs);
  if (prevMax !== value.maxJobs) {
    setPrevMax(value.maxJobs);
    if (Number(maxText) !== value.maxJobs) setMaxText(String(value.maxJobs));
  }

  const [unmatched, setUnmatched] = useState<number | null>(null);
  const { includeDiscovered, includeTracked } = value;
  useEffect(() => {
    let live = true;
    countUnmatchedJobs({ includeDiscovered, includeTracked })
      .then((r) => live && setUnmatched(r.success ? (r.count ?? 0) : null))
      .catch(() => live && setUnmatched(null));
    return () => {
      live = false;
    };
  }, [includeDiscovered, includeTracked]);

  const nothingSelected = !includeDiscovered && !includeTracked;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Scores jobs you have already saved that have no AI match yet, using
        your AI provider. It searches for nothing new.
      </p>

      <div className="space-y-3">
        <Label>Jobs to score</Label>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="aimatch-discovered" className="font-normal">
              Listings from search automations
            </Label>
            <p className="text-sm text-muted-foreground">
              Extra listings saved without an AI analysis. Dismissed ones are
              skipped.
            </p>
          </div>
          <Switch
            id="aimatch-discovered"
            checked={includeDiscovered}
            onCheckedChange={(checked) => update({ includeDiscovered: checked })}
          />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="aimatch-tracked" className="font-normal">
              Jobs in My Jobs with no score
            </Label>
            <p className="text-sm text-muted-foreground">
              Jobs you added yourself and never matched.
            </p>
          </div>
          <Switch
            id="aimatch-tracked"
            checked={includeTracked}
            onCheckedChange={(checked) => update({ includeTracked: checked })}
          />
        </div>
        {nothingSelected ? (
          <p className="text-sm text-destructive">
            Choose at least one kind of job to score.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="aimatch-count">
            {unmatched === null
              ? "Jobs you have rejected, archived or withdrawn from, and expired ones, are never scored."
              : `${unmatched} job${unmatched === 1 ? "" : "s"} unmatched right now. Rejected, archived, withdrawn and expired jobs are never scored.`}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="aimatch-max">Jobs to score per run</Label>
        <Input
          id="aimatch-max"
          type="number"
          inputMode="numeric"
          min={1}
          max={AI_MATCH_MAX_JOBS}
          className="w-28"
          value={maxText}
          onChange={(e) => {
            setMaxText(e.target.value);
            const n = Math.trunc(Number(e.target.value));
            if (n >= 1) update({ maxJobs: Math.min(n, AI_MATCH_MAX_JOBS) });
          }}
          onBlur={() => setMaxText(String(value.maxJobs))}
        />
        <p className="text-sm text-muted-foreground">
          The most a run scores, 1 to {AI_MATCH_MAX_JOBS}. Each job is one AI
          request; with a local model they run one at a time.
        </p>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="aimatch-newest">Newest jobs first</Label>
          <p className="text-sm text-muted-foreground">
            Score the most recently added jobs first. Turn off to work through
            the oldest first.
          </p>
        </div>
        <Switch
          id="aimatch-newest"
          checked={value.newestFirst}
          onCheckedChange={(checked) => update({ newestFirst: checked })}
        />
      </div>

      <div className="space-y-2">
        <Label>Resume to match against</Label>
        <RadioGroup
          value={value.resumeSource}
          onValueChange={(v) =>
            update({ resumeSource: v as AiMatchConfig["resumeSource"] })
          }
          className="space-y-1"
        >
          <div className="flex items-start gap-2">
            <RadioGroupItem value="job" id="aimatch-resume-job" className="mt-1" />
            <Label htmlFor="aimatch-resume-job" className="font-normal leading-snug">
              Each job&apos;s own resume
              <span className="block text-sm text-muted-foreground">
                The resume of the automation that found it, or the one linked
                to the job; otherwise the resume chosen in the next step.
              </span>
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <RadioGroupItem
              value="automation"
              id="aimatch-resume-automation"
              className="mt-1"
            />
            <Label
              htmlFor="aimatch-resume-automation"
              className="font-normal leading-snug"
            >
              Always the resume chosen in the next step
            </Label>
          </div>
        </RadioGroup>
      </div>
    </div>
  );
}
