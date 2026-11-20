import Link from "next/link";
import { Ban, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { JobMatchDealBreakers } from "@/models/ai.schemas";
import { dealBreakersFromMatchData } from "@/lib/ai/dealBreakers";

// Banner at the top of a match: which of the user's deal breakers the job
// has, and whether that moved it to Withdrawn. Quiet line when none were hit.
export function DealBreakerNotice({
  dealBreakers,
}: {
  dealBreakers: JobMatchDealBreakers | undefined;
}) {
  if (!dealBreakers || dealBreakers.checked.length === 0) return null;

  if (dealBreakers.found.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />
        No deal breakers found ({dealBreakers.checked.length} checked)
      </p>
    );
  }

  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2"
    >
      <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
        <Ban className="h-4 w-4" />
        {dealBreakers.found.length === 1
          ? "Deal breaker found"
          : `${dealBreakers.found.length} deal breakers found`}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {dealBreakers.found.map((item) => (
          <Badge key={item} variant="destructive">
            {item}
          </Badge>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {dealBreakers.withdrawn
          ? "This job was moved to Withdrawn because of it. "
          : ""}
        The analysis below quotes what the AI found.{" "}
        <Link
          href="/dashboard/settings?section=deal-breakers"
          className="underline hover:text-foreground"
        >
          Edit deal breakers
        </Link>
      </p>
    </div>
  );
}

// Compact marker for list rows, under the match score.
export function DealBreakerFlag({ matchData }: { matchData: unknown }) {
  const found = dealBreakersFromMatchData(matchData)?.found ?? [];
  if (found.length === 0) return null;
  return (
    <Badge
      variant="destructive"
      className="text-[10px] px-1.5 py-0 gap-0.5 whitespace-nowrap"
      title={`Deal breaker: ${found.join(", ")}`}
    >
      <Ban className="h-3 w-3" />
      Deal breaker
    </Badge>
  );
}
