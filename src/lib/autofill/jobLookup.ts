import db from "@/lib/db";
import type { AutofillJobRef } from "./types";

// Stable identities for a posting URL. ATS job ids survive the different
// URLs one posting has (listing page, /apply page, an embed on the
// company's own site with ?gh_jid=).
export function jobKeysFromUrl(raw: string): string[] {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return [];
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");
  const keys: string[] = [];

  const ghParam = url.searchParams.get("gh_jid") ?? (/greenhouse\.io$/.test(host) ? url.searchParams.get("token") : null);
  if (ghParam && /^\d+$/.test(ghParam)) keys.push(`greenhouse:${ghParam}`);
  if (/greenhouse\.io$/.test(host)) {
    const m = path.match(/\/jobs\/(\d+)/);
    if (m) keys.push(`greenhouse:${m[1]}`);
  }
  if (/lever\.co$/.test(host)) {
    const m = path.match(/\/([0-9a-f]{8}-[0-9a-f-]{27,})/i);
    if (m) keys.push(`lever:${m[1].toLowerCase()}`);
  }
  if (/ashbyhq\.com$/.test(host)) {
    const m = path.match(/\/([0-9a-f]{8}-[0-9a-f-]{27,})/i);
    if (m) keys.push(`ashby:${m[1].toLowerCase()}`);
  }

  const plain = path.replace(/\/(?:apply|application|applications)$/i, "");
  if (plain) keys.push(`url:${host}${plain.toLowerCase()}`);
  return [...new Set(keys)];
}

// The text to search jobUrl for: the ATS id, or the URL's path
function searchTerm(key: string): string {
  const value = key.slice(key.indexOf(":") + 1);
  if (key.startsWith("url:")) {
    const segments = value.split("/").filter(Boolean);
    return segments.slice(-1)[0] ?? value;
  }
  return value;
}

export type FoundJob = AutofillJobRef & {
  description: string;
  resumeId: string | null;
};

export async function findJobForUrls(
  userId: string,
  urls: string[],
): Promise<FoundJob | null> {
  const pageKeys = new Set(urls.flatMap(jobKeysFromUrl));
  if (pageKeys.size === 0) return null;
  const terms = [...new Set([...pageKeys].map(searchTerm))].filter(
    (t) => t.length >= 4,
  );
  if (terms.length === 0) return null;

  const candidates = await db.job.findMany({
    where: {
      userId,
      OR: terms.map((t) => ({ jobUrl: { contains: t } })),
    },
    select: {
      id: true,
      jobUrl: true,
      description: true,
      resumeId: true,
      JobTitle: { select: { label: true } },
      Company: { select: { label: true } },
      Status: { select: { value: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  for (const job of candidates) {
    if (!job.jobUrl) continue;
    if (jobKeysFromUrl(job.jobUrl).some((k) => pageKeys.has(k))) {
      return {
        id: job.id,
        title: job.JobTitle?.label ?? "",
        company: job.Company?.label ?? "",
        status: job.Status?.value ?? "",
        description: job.description ?? "",
        resumeId: job.resumeId ?? null,
      };
    }
  }
  return null;
}
