import type { AutofillField, AutofillValue } from "../../../src/lib/autofill/types";
import type { AnswerCandidate, CollectedValue } from "./protocol";

function norm(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? [...v].sort().join("; ") : (v ?? "");
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Answers worth remembering after the user reviewed a form: what they typed
// where JobSync had nothing, or where they changed JobSync's value. Contact
// details, uploads, consent ticks and long essays are left out.
export function answersToRemember(
  fields: AutofillField[],
  filled: Map<string, AutofillValue>,
  current: CollectedValue[],
): AnswerCandidate[] {
  const now = new Map(current.map((c) => [c.id, c.value]));
  const out: AnswerCandidate[] = [];
  for (const field of fields) {
    if (field.type === "file" || field.type === "checkbox") continue;
    const before = filled.get(field.id);
    if (before?.source === "profile" || before?.source === "resume") continue;
    const value = now.get(field.id);
    const text = Array.isArray(value) ? value.join("; ") : (value ?? "").trim();
    if (!text) continue;
    if (field.type === "textarea" && text.length > 300) continue;
    const userTyped = !before || before.source === "none";
    if (!userTyped && norm(value) === norm(before.value)) continue;
    out.push({ id: field.id, question: field.label, answer: text });
  }
  return out;
}

// Title and company from the page title, for adding the job to JobSync.
// The user can edit both before saving.
export function guessJob(title: string, url: string): { jobTitle: string; company: string } {
  const t = title.replace(/\s+/g, " ").trim();
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }

  const gh = t.match(/^Job Application for (.+?) at (.+)$/i);
  if (gh) return { jobTitle: gh[1].trim(), company: gh[2].trim() };

  if (/lever\.co$/.test(host)) {
    const m = t.match(/^(.+?) - (.+)$/);
    if (m) return { company: m[1].trim(), jobTitle: m[2].trim() };
  }
  const at = t.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s+[|–—-]\s+.*)?$/i);
  if (at) return { jobTitle: at[1].trim(), company: at[2].trim() };

  const parts = t.split(/\s+[|–—-]\s+/);
  const fromHost = (() => {
    const seg = host.split(".");
    // careers.acme.com -> acme; jobs.lever.co/acme is handled above
    const name = seg.length >= 2 ? seg[seg.length - 2] : seg[0] ?? "";
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
  })();
  return { jobTitle: parts[0] ?? t, company: parts[1] ?? fromHost };
}
