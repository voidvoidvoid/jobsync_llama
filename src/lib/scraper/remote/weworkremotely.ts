import { APP_CONSTANTS } from "@/lib/constants";
import type { JobDetails, ScraperResult } from "../types";
import { fetchFeedText, text } from "./http";
import { compactRemoteLocation } from "./location";

export const WWR = "We Work Remotely";

// Undo XML's own escaping, exactly once. (html.ts's decodeHtml decodes twice,
// which here would also unescape the HTML inside a description.)
function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&"); // last, so "&amp;lt;" ends as "&lt;"
}

// The text of one child element of an RSS item, CDATA unwrapped and entities
// decoded. The feed is machine-written and flat, so a pattern per element is
// enough and saves an XML dependency.
function field(item: string, tag: string): string {
  const match = item.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"),
  );
  if (!match) return "";
  const raw = match[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  // CDATA is literal; anything else is entity-encoded once by the XML layer.
  return (cdata ? cdata[1] : decodeXml(raw)).trim();
}

// Titles read "Company: Job title". The company comes first and the split is
// on the first colon-space; a title without one is all job title.
function splitTitle(raw: string): { company: string; title: string } {
  const at = raw.indexOf(": ");
  if (at <= 0) return { company: "", title: raw.trim() };
  return { company: raw.slice(0, at).trim(), title: raw.slice(at + 2).trim() };
}

export function mapWwrItem(item: string): JobDetails | null {
  const { company, title } = splitTitle(field(item, "title"));
  // The link is the posting on We Work Remotely, which its terms ask to be
  // the way in: applications go through that page.
  const url = field(item, "link") || field(item, "guid");
  if (!title || !/^https?:\/\//i.test(url)) return null;

  const posted = field(item, "pubDate");
  // Region reads "Anywhere in the World", "USA Only", "Europe Only"; country,
  // when present, names it more exactly. Both are kept for the location test.
  const places = [field(item, "region"), field(item, "country")].filter(Boolean);
  const location =
    Array.from(new Set(places)).join(", ") || "Anywhere in the World";

  return {
    title,
    company: company || "Unknown company",
    location,
    locationLabel: compactRemoteLocation(location),
    description: field(item, "description"),
    url,
    postedDate:
      posted && !Number.isNaN(Date.parse(posted))
        ? new Date(posted).toISOString()
        : undefined,
    employmentType: text(field(item, "type")) || undefined,
    isRemote: true,
    workplaceType: "REMOTE",
    source: WWR,
  };
}

// The public RSS feed: the newest postings across every category, in one
// request and with no search. A daily run sees everything posted in between.
export async function fetchWwrJobs(): Promise<ScraperResult<JobDetails[]>> {
  const result = await fetchFeedText(APP_CONSTANTS.WWR_RSS_URL, WWR);
  if (!result.success) return result;

  const xml = result.data;
  if (!/<rss[\s>]|<channel[\s>]/i.test(xml)) {
    return {
      success: false,
      error: { type: "parse", message: `${WWR} sent a malformed response` },
    };
  }

  const jobs: JobDetails[] = [];
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const mapped = mapWwrItem(match[1]);
    if (mapped) jobs.push(mapped);
  }
  return { success: true, data: jobs };
}
