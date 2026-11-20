import type { AutofillConfidence } from "./types";

export type ParsedAiAnswer = { value: unknown; confidence: AutofillConfidence };

// Reads {"answers":[...]} from a model reply that may carry a thinking block,
// code fences or text around the JSON. Unknown ids are dropped by the caller.
export function parseAutofillReply(text: string): Map<string, ParsedAiAnswer> {
  const out = new Map<string, ParsedAiAnswer>();
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "");
  const brace = cleaned.indexOf("{");
  const bracket = cleaned.indexOf("[");
  const isArray = bracket >= 0 && (brace < 0 || bracket < brace);
  const start = isArray ? bracket : brace;
  const end = cleaned.lastIndexOf(isArray ? "]" : "}");
  if (start < 0 || end <= start) return out;

  let data: unknown;
  try {
    data = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return out;
  }
  const list = Array.isArray(data)
    ? data
    : (data as { answers?: unknown })?.answers;
  if (!Array.isArray(list)) return out;

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { id, value, confidence } = item as Record<string, unknown>;
    if (typeof id !== "string") continue;
    out.set(id, {
      value,
      confidence:
        confidence === "high" || confidence === "low" ? confidence : "medium",
    });
  }
  return out;
}
