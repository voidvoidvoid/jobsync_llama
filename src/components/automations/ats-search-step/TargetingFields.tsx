"use client";

import { TriangleAlert } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { getAllJobTitles, createJobTitle } from "@/actions/jobtitle.actions";
import { getAllTags, createTag } from "@/actions/tag.actions";
import { getAllJobLocations } from "@/actions/jobLocation.actions";
import { createLocation } from "@/actions/job.actions";
import { EntityStringChipInput } from "./EntityStringChipInput";
import type { AtsConfigValue } from "./types";

interface TargetingFieldsProps {
  value: AtsConfigValue;
  onChange: (next: AtsConfigValue) => void;
  // Remote job boards: titles and keywords are also what the boards are
  // searched with, and a location is where the candidate may live.
  remote?: boolean;
}

export function TargetingFields({
  value,
  onChange,
  remote = false,
}: TargetingFieldsProps) {
  // Without target titles or keywords there is no signal to rank jobs against,
  // so the relevance floor drops everything and nothing is saved.
  const noSignal =
    (value.targetTitles?.length ?? 0) === 0 &&
    (value.keywords?.length ?? 0) === 0;

  return (
    <>
      <EntityStringChipInput
        label="Target job titles"
        placeholder="e.g., Frontend Engineer"
        noun="job title"
        description={
          remote
            ? "Searched on each job board, and listings whose title matches rank higher."
            : "Optional. Listings whose title matches rank higher."
        }
        values={value.targetTitles ?? []}
        onChange={(next) => onChange({ ...value, targetTitles: next })}
        loadOptions={async () => {
          const res = await getAllJobTitles();
          return Array.isArray(res) ? res : [];
        }}
        createOption={async (lbl) => {
          const res = await createJobTitle(lbl);
          return res?.id ? res : null;
        }}
      />

      <EntityStringChipInput
        label="Keywords / skills"
        placeholder="e.g., React"
        noun="keyword"
        description={
          remote
            ? "Searched on each job board, and matched against title and description. The first six titles and keywords are used as searches."
            : "Optional. Matched against title and description."
        }
        values={value.keywords ?? []}
        onChange={(next) => onChange({ ...value, keywords: next })}
        loadOptions={async () => {
          const res = await getAllTags();
          return Array.isArray(res) ? res : [];
        }}
        createOption={async (lbl) => {
          const res = await createTag(lbl);
          return res?.success ? res.data : null;
        }}
      />

      <EntityStringChipInput
        label="Exclude keywords"
        placeholder="e.g., Senior, Clearance"
        noun="word to exclude"
        plainWords
        description="Optional. A listing containing any of these words or phrases is dropped before ranking, never saved or sent to the AI. Whole words only, case ignored."
        values={value.excludeKeywords ?? []}
        onChange={(next) => onChange({ ...value, excludeKeywords: next })}
        // Plain words, kept only on this automation: no suggestions, and
        // nothing is added to your tags.
        loadOptions={async () => []}
        createOption={async (lbl) => ({ id: lbl, label: lbl, value: lbl })}
      />

      {(value.excludeKeywords?.length ?? 0) > 0 && (
        <div className="space-y-2 -mt-2">
          <Label>Look for excluded words in</Label>
          <RadioGroup
            value={value.excludeIn ?? "all"}
            onValueChange={(v) =>
              onChange({ ...value, excludeIn: v as "all" | "title" })
            }
            className="flex flex-wrap gap-x-6 gap-y-1"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="all" id="exclude-in-all" />
              <Label htmlFor="exclude-in-all" className="font-normal">
                Title and description
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="title" id="exclude-in-title" />
              <Label htmlFor="exclude-in-title" className="font-normal">
                Title only
              </Label>
            </div>
          </RadioGroup>
          <p className="text-sm text-muted-foreground">
            Descriptions often mention a word in passing (&quot;no clearance
            required&quot;), so title only drops fewer listings by mistake.
          </p>
        </div>
      )}

      {noSignal && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Add at least one target title or keyword. Without them there is
            nothing to rank jobs against, so this automation will save no
            listings.
          </span>
        </div>
      )}

      <EntityStringChipInput
        label={remote ? "Where you can work from" : "Locations"}
        placeholder={remote ? "e.g., United States, Europe" : "e.g., Calgary, Seattle"}
        noun="location"
        description={
          remote
            ? "Optional. Countries or regions, spelled as a posting would. Used only when the toggle below is on."
            : "Optional. Used only to filter results when the toggle below is on (not part of ranking)."
        }
        values={value.locations ?? []}
        onChange={(next) => onChange({ ...value, locations: next })}
        loadOptions={async () => {
          const res = await getAllJobLocations();
          return Array.isArray(res) ? res : [];
        }}
        createOption={async (lbl) => {
          const res = await createLocation(lbl);
          return res?.success ? res.data : null;
        }}
      />

      <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
        <div className="space-y-1">
          <Label>
            {remote
              ? "Only show jobs open to these locations"
              : "Only show jobs in these locations"}
          </Label>
          <p className="text-sm text-muted-foreground">
            {remote
              ? "When on, roles restricted to other places are dropped before ranking. Roles open worldwide always pass."
              : "When on, jobs matching none of your locations are dropped before ranking. Remote roles always pass."}
          </p>
        </div>
        <Switch
          checked={!!value.strictLocation}
          disabled={(value.locations ?? []).length === 0}
          onCheckedChange={(checked) =>
            onChange({ ...value, strictLocation: checked })
          }
        />
      </div>
    </>
  );
}
