import { normalizeQuestion, topicOf } from "./classify";
import type { AutofillField, SavedAnswer } from "./types";

const YES = /^(?:y|yes|true|1|i do|i am|i will|i have|correct|agree)\b/;
// Both run on normalizeQuestion() output: lowercase words, no punctuation
const NO = /^(?:n|no|false|0|i do not|i don t|i am not|i will not|i won t|i have not|none)\b/;
const DECLINE = /decline|prefer not|do not wish|don t wish|not wish|choose not|rather not|not to (?:say|answer|disclose|self identify)|not specified|wish not|wish to not/;

function words(text: string): string[] {
  return normalizeQuestion(text).split(" ").filter(Boolean);
}

function overlap(a: string, b: string): number {
  const wa = new Set(words(a));
  const wb = new Set(words(b));
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.max(wa.size, wb.size);
}

// Picks the option a free-text answer means: an exact or near-exact match,
// then yes/no and "decline to answer" by meaning, then the closest wording.
// Null when nothing is close enough, so a wrong choice is never made.
export function matchOption(answer: string, options: string[]): string | null {
  const a = answer.trim();
  if (!a || options.length === 0) return null;
  const na = normalizeQuestion(a);
  if (!na) return null;

  const exact = options.find((o) => normalizeQuestion(o) === na);
  if (exact) return exact;

  const starts = options.filter((o) => {
    const no = normalizeQuestion(o);
    return no.length > 0 && (no.startsWith(na) || na.startsWith(no));
  });
  if (starts.length === 1) return starts[0];

  if (DECLINE.test(na)) {
    const decline = options.find((o) => DECLINE.test(normalizeQuestion(o)));
    if (decline) return decline;
  }
  const yes = YES.test(na) && !NO.test(na);
  const no = NO.test(na);
  if (yes || no) {
    const pick = options.filter((o) => {
      const no2 = normalizeQuestion(o);
      return yes ? YES.test(no2) && !NO.test(no2) : NO.test(no2);
    });
    if (pick.length === 1) return pick[0];
  }

  let best: string | null = null;
  let bestScore = 0;
  for (const o of options) {
    const s = overlap(a, o);
    if (s > bestScore) {
      bestScore = s;
      best = o;
    }
  }
  return bestScore >= 0.6 ? best : null;
}

// Turns a proposed answer into a value the field accepts, or null.
export function coerceValue(
  field: AutofillField,
  raw: unknown,
): string | string[] | null {
  if (raw === null || raw === undefined) return null;
  const options = field.options ?? [];

  if (field.type === "checkbox-group") {
    const list = Array.isArray(raw)
      ? raw
      : String(raw).split(/[;,\n]/);
    const picked = new Set<string>();
    for (const item of list) {
      const m = matchOption(String(item), options);
      if (m) picked.add(m);
    }
    return picked.size > 0 ? [...picked] : null;
  }

  const text = (Array.isArray(raw) ? raw.join(", ") : String(raw)).trim();
  if (!text) return null;

  switch (field.type) {
    case "select":
    case "radio":
      return matchOption(text, options);
    case "combobox":
      return options.length > 0 ? matchOption(text, options) : text;
    case "checkbox": {
      const n = normalizeQuestion(text);
      if (YES.test(n) && !NO.test(n)) return "yes";
      if (NO.test(n)) return "no";
      return null;
    }
    case "number": {
      const m = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
      return m ? m[0] : null;
    }
    case "date": {
      const iso = text.match(/\d{4}-\d{2}-\d{2}/);
      return iso ? iso[0] : null;
    }
    case "file":
      return null;
    default:
      return field.maxLength && field.maxLength > 0
        ? text.slice(0, field.maxLength)
        : text;
  }
}

// The saved answer for a page's question: the same wording, the same kind of
// question (newest saved first), or wording that is nearly the same.
export function findSavedAnswer(
  field: AutofillField,
  saved: SavedAnswer[],
): SavedAnswer | undefined {
  if (saved.length === 0) return undefined;
  const q = normalizeQuestion(field.label);
  if (!q) return undefined;
  const newest = [...saved].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const exact = newest.find((s) => normalizeQuestion(s.question) === q);
  if (exact) return exact;

  const topic = topicOf(field.label);
  if (topic && topic !== "consent" && topic !== "cover_letter") {
    // A saved answer is only reused if it fits this field's choices
    const sameTopic = newest.filter((s) => topicOf(s.question) === topic);
    for (const s of sameTopic) {
      if (coerceValue(field, s.answer) !== null) return s;
    }
  }

  if (words(field.label).length >= 3) {
    return newest.find((s) => overlap(s.question, field.label) >= 0.75);
  }
  return undefined;
}

export function normalizeSavedAnswers(input: unknown): SavedAnswer[] {
  if (!Array.isArray(input)) return [];
  const out: SavedAnswer[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Partial<SavedAnswer>;
    const question = String(r.question ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    const answer = String(r.answer ?? "").trim().slice(0, 2000);
    const key = normalizeQuestion(question);
    if (!question || !answer || !key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: typeof r.id === "string" && r.id ? r.id : cryptoId(),
      question,
      answer,
      updatedAt:
        typeof r.updatedAt === "string" && r.updatedAt
          ? r.updatedAt
          : new Date().toISOString(),
    });
    if (out.length >= 300) break;
  }
  return out;
}

// Adds or replaces answers by question wording; newest wins.
export function mergeSavedAnswers(
  existing: SavedAnswer[],
  incoming: Array<{ question: string; answer: string }>,
  now = new Date(),
): SavedAnswer[] {
  const byKey = new Map(existing.map((s) => [normalizeQuestion(s.question), s]));
  for (const { question, answer } of incoming) {
    const q = question.replace(/\s+/g, " ").trim().slice(0, 300);
    const a = answer.trim().slice(0, 2000);
    const key = normalizeQuestion(q);
    if (!key || !a) continue;
    const prev = byKey.get(key);
    byKey.set(key, {
      id: prev?.id ?? cryptoId(),
      question: q,
      answer: a,
      updatedAt: now.toISOString(),
    });
  }
  // Newest first, capped: the oldest answers drop off
  return normalizeSavedAnswers(
    [...byKey.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
}

function cryptoId(): string {
  return globalThis.crypto.randomUUID();
}
