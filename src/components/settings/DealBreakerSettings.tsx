"use client";
import { useEffect, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Badge } from "../ui/badge";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  getUserSettings,
  updateDealBreakerSettings,
} from "@/actions/userSettings.actions";
import {
  DEAL_BREAKER_LIMITS,
  normalizeDealBreakers,
  type DealBreakerSettings as DealBreakerValues,
} from "@/models/userSettings.model";

const EXAMPLES = ["occasional travel", "must be willing to relocate"];

function DealBreakerSettings() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [values, setValues] = useState<DealBreakerValues>(
    normalizeDealBreakers(undefined),
  );
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getUserSettings();
        if (!cancelled && result?.success) {
          setValues(normalizeDealBreakers(result.data?.settings?.dealBreakers));
        }
      } catch (error) {
        console.error("Error fetching deal breakers:", error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const atLimit = values.items.length >= DEAL_BREAKER_LIMITS.maxItems;

  const addDraft = () => {
    const phrase = draft.replace(/\s+/g, " ").trim();
    if (!phrase || atLimit) return;
    const exists = values.items.some(
      (item) => item.toLowerCase() === phrase.toLowerCase(),
    );
    if (!exists) {
      setValues((v) => normalizeDealBreakers({ ...v, items: [...v.items, phrase] }));
    }
    setDraft("");
  };

  const remove = (item: string) =>
    setValues((v) => ({ ...v, items: v.items.filter((x) => x !== item) }));

  const save = async () => {
    setIsSaving(true);
    try {
      // A phrase still in the box counts, so Save does what it looks like.
      const pending = draft.trim();
      const next = normalizeDealBreakers(
        pending ? { ...values, items: [...values.items, pending] } : values,
      );
      const result = await updateDealBreakerSettings(next);
      if (result?.success) {
        setValues(normalizeDealBreakers(result.data?.settings?.dealBreakers));
        setDraft("");
        toastSuccess("Your deal breakers have been saved.");
      } else {
        toastError(result?.message || "Failed to save deal breakers.");
      }
    } catch {
      toastError("Failed to save deal breakers.");
    } finally {
      setIsSaving(false);
    }
  };

  const header = (
    <div>
      <h3 className="text-lg font-medium">Deal Breakers</h3>
      <p className="text-sm text-muted-foreground">
        Conditions you will not accept in a job. Every AI match checks the job
        description for them and flags the ones it finds.
      </p>
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        {header}
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {header}

      <div className="space-y-2">
        <Label htmlFor="deal-breaker-input">Add a deal breaker</Label>
        <div className="flex gap-2">
          <Input
            id="deal-breaker-input"
            value={draft}
            maxLength={DEAL_BREAKER_LIMITS.maxLength}
            placeholder={`e.g. ${EXAMPLES[0]}`}
            disabled={atLimit}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addDraft();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={addDraft}
            disabled={!draft.trim() || atLimit}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Describe the condition in your own words, such as &ldquo;
          {EXAMPLES.join("” or “")}&rdquo;. The AI looks for the meaning, not the
          exact phrase. Up to {DEAL_BREAKER_LIMITS.maxItems}.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Deal breakers">
        {values.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deal breakers yet.</p>
        ) : (
          values.items.map((item) => (
            <Badge key={item} variant="secondary" className="gap-1 pr-1 text-sm">
              {item}
              <button
                type="button"
                aria-label={`Remove ${item}`}
                className="rounded-sm p-0.5 hover:bg-muted"
                onClick={() => remove(item)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))
        )}
      </div>

      <div className="flex items-start gap-3 rounded-md border p-3">
        <Switch
          id="deal-breaker-withdraw"
          checked={values.withdraw}
          onCheckedChange={(withdraw) => setValues((v) => ({ ...v, withdraw }))}
        />
        <div className="space-y-1">
          <Label htmlFor="deal-breaker-withdraw">
            Move matching jobs to Withdrawn
          </Label>
          <p className="text-xs text-muted-foreground">
            Only jobs still in New or Draft are moved. Jobs you have applied to
            or are interviewing for keep their status and are only flagged.
          </p>
        </div>
      </div>

      <Button type="button" onClick={save} disabled={isSaving}>
        {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Save deal breakers
      </Button>
    </div>
  );
}

export default DealBreakerSettings;
