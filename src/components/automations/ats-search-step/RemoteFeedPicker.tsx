"use client";

import { ExternalLink } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { REMOTE_FEEDS, type RemoteFeed } from "@/models/automation.model";

interface RemoteFeedPickerProps {
  feeds: { name: string; token: string }[];
  onChange: (next: RemoteFeed[]) => void;
}

// The remote board's stand-in for the company picker: which public remote-job
// feeds to read. Each is credited by name and linked to its own site.
export function RemoteFeedPicker({ feeds, onChange }: RemoteFeedPickerProps) {
  const selected = new Set(feeds.map((f) => f.token));

  const toggle = (token: string, on: boolean) => {
    // Rebuilt from REMOTE_FEEDS so the saved order and names stay canonical.
    onChange(
      REMOTE_FEEDS.filter((feed) =>
        feed.token === token ? on : selected.has(feed.token),
      ).map(({ name, token: id }) => ({ name, token: id })),
    );
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
          <div
            key={feed.token}
            className="flex items-start justify-between gap-4 p-3"
          >
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
