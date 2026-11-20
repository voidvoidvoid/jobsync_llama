import { generateText } from "ai";
import { getModel } from "@/lib/ai";
import {
  AUTOFILL_SYSTEM_PROMPT,
  buildAutofillPrompt,
} from "@/lib/ai/prompts/autofill";
import { startAiCall } from "@/lib/aiUsage/tracker";
import {
  getDefaultModelForProvider,
  getUserAiSettings,
} from "@/lib/scraper/automation-run/aiSettings";
import { log } from "@/lib/telemetry";
import { coerceValue, findSavedAnswer } from "./answers";
import {
  isSensitiveTopic,
  profileKeyOf,
  topicOf,
} from "./classify";
import { loadAutofillContext, type AutofillContext } from "./context";
import { findJobForUrls, type FoundJob } from "./jobLookup";
import { parseAutofillReply, type ParsedAiAnswer } from "./parse";
import {
  AUTOFILL_LIMITS,
  type AutofillField,
  type AutofillFillRequest,
  type AutofillFillResponse,
  type AutofillValue,
} from "./types";

// Server-only. Decides a value for every field: contact details from the
// profile, then the user's saved answers, then the AI for what is left.
// Sensitive questions never reach the AI.

const AI_BATCH = 20;
const JOB_TEXT_LIMIT = 8000;

export type AutofillGenerate = (input: {
  userId: string;
  system: string;
  prompt: string;
}) => Promise<string>;

export const NOTES = {
  sensitive:
    "Personal or legal question: answer it yourself, or save an answer in JobSync to fill it next time.",
  noAnswer: "Nothing in your resume or saved answers answers this.",
  aiFailed: "The AI request failed; fill this yourself.",
  coverFile: "Attach a cover letter yourself.",
  otherFile: "Not a resume upload; attach this yourself.",
  noResumeFile: "Your resume in JobSync has no uploaded file.",
  draft: "AI draft: read and edit before submitting.",
  savedAnswer: "Your saved answer",
} as const;

function none(field: AutofillField, note: string, topic?: string): AutofillValue {
  return { id: field.id, value: "", source: "none", confidence: "low", note, ...(topic ? { topic } : {}) };
}

function stripHtml(html: string): string {
  return html
    .replace(/<(?:br|\/p|\/li|\/h\d)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function fileValue(field: AutofillField, ctx: AutofillContext): AutofillValue {
  const text = `${field.label} ${field.name ?? ""}`.toLowerCase();
  if (/cover|motivation/.test(text)) return none(field, NOTES.coverFile);
  const isResume = /resume|résumé|\bcv\b|curriculum/.test(text) || !/transcript|portfolio|photo|certificate|writing sample|reference/.test(text);
  if (!isResume) return none(field, NOTES.otherFile);
  if (!ctx.resume?.hasFile) return none(field, NOTES.noResumeFile);
  return {
    id: field.id,
    value: ctx.resume.fileName ?? ctx.resume.title,
    source: "resume",
    confidence: "high",
  };
}

function profileLines(ctx: AutofillContext): string[] {
  const p = ctx.profile;
  return [
    p.fullName && `Name: ${p.fullName}`,
    p.email && `Email: ${p.email}`,
    p.phone && `Phone: ${p.phone}`,
    p.headline && `Headline: ${p.headline}`,
    p.address && `Location: ${p.address}`,
    p.linkedin && `LinkedIn: ${p.linkedin}`,
    p.github && `GitHub: ${p.github}`,
    p.website && `Website: ${p.website}`,
    ...(p.otherLinks ?? []).map((l) => `Link: ${l}`),
  ].filter((x): x is string => !!x);
}

// The value a field gets without the AI, or null to ask the AI.
export function decideWithoutAi(
  field: AutofillField,
  ctx: AutofillContext,
): AutofillValue | null {
  if (field.type === "file") return fileValue(field, ctx);

  const key = profileKeyOf(field);
  const fromProfile = key ? ctx.profile[key] : undefined;
  if (fromProfile) {
    return { id: field.id, value: fromProfile, source: "profile", confidence: "high" };
  }

  const topic = topicOf(field.label);
  const saved = findSavedAnswer(field, ctx.answers);
  if (saved) {
    const value = coerceValue(field, saved.answer);
    if (value !== null) {
      return {
        id: field.id,
        value,
        source: "answer",
        confidence: "high",
        note: NOTES.savedAnswer,
        ...(topic ? { topic } : {}),
      };
    }
  }
  if (isSensitiveTopic(topic)) {
    const note = saved
      ? `Your saved answer "${saved.answer}" does not match the choices here.`
      : NOTES.sensitive;
    return none(field, note, topic);
  }
  return null;
}

const defaultGenerate: AutofillGenerate = async ({ userId, system, prompt }) => {
  const ai = await getUserAiSettings(userId);
  const modelName = ai.model || getDefaultModelForProvider(ai.provider);
  const model = await getModel(ai.provider, modelName, userId);
  const tracker = startAiCall({
    userId,
    feature: "autofill",
    provider: ai.provider,
    model: modelName,
  });
  try {
    const result = await generateText({
      model,
      instructions: system,
      prompt,
      temperature: 0.2,
    });
    void tracker.finish({ usage: result.usage, finishReason: result.finishReason });
    return result.text;
  } catch (error) {
    void tracker.finish({ error });
    throw error;
  }
};

function sanitizeField(f: AutofillField): AutofillField {
  return {
    ...f,
    label: f.label.replace(/\s+/g, " ").trim().slice(0, AUTOFILL_LIMITS.maxLabel),
    options: f.options?.slice(0, AUTOFILL_LIMITS.maxOptions),
  };
}

export async function runAutofill(
  userId: string,
  request: AutofillFillRequest,
  generate: AutofillGenerate = defaultGenerate,
): Promise<AutofillFillResponse> {
  const fields = request.fields.slice(0, AUTOFILL_LIMITS.maxFields).map(sanitizeField);
  const warnings: string[] = [];
  if (request.fields.length > fields.length) {
    warnings.push(`Only the first ${fields.length} fields were filled.`);
  }

  const job: FoundJob | null = await findJobForUrls(userId, [
    request.url,
    ...(request.frameUrls ?? []),
  ]);
  const ctx = await loadAutofillContext(userId, job?.resumeId);
  if (!ctx.resume) {
    warnings.push("You have no resume in JobSync, so only saved answers were used.");
  }

  const decided = new Map<string, AutofillValue>();
  const forAi: AutofillField[] = [];
  for (const field of fields) {
    const v = decideWithoutAi(field, ctx);
    if (v) decided.set(field.id, v);
    else forAi.push(field);
  }

  if (forAi.length > 0) {
    const jobDescription = (
      job?.description ? stripHtml(job.description) : (request.pageText ?? "")
    ).slice(0, JOB_TEXT_LIMIT);
    const jobTitle = job ? `${job.title} at ${job.company}` : request.title;

    for (let i = 0; i < forAi.length; i += AI_BATCH) {
      const batch = forAi.slice(i, i + AI_BATCH);
      const prompt = buildAutofillPrompt({
        profileLines: profileLines(ctx),
        resumeText: ctx.resume?.text ?? "",
        savedAnswers: ctx.answers.slice(0, 60),
        jobTitle,
        jobDescription,
        fields: batch,
        today: new Date().toISOString().slice(0, 10),
      });
      let reply: Map<string, ParsedAiAnswer>;
      try {
        reply = parseAutofillReply(
          await generate({ userId, system: AUTOFILL_SYSTEM_PROMPT, prompt }),
        );
      } catch (error) {
        log.error("[Autofill] AI request failed", { error: String(error) });
        if (!warnings.some((w) => w.startsWith("The AI request failed"))) {
          warnings.push(`The AI request failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        for (const f of batch) decided.set(f.id, none(f, NOTES.aiFailed));
        continue;
      }
      if (reply.size === 0) {
        warnings.push("The AI reply could not be read; some fields were left empty.");
      }
      for (const f of batch) {
        const answer = reply.get(f.id);
        const value = answer ? coerceValue(f, answer.value) : null;
        const empty =
          value === null || (Array.isArray(value) ? value.length === 0 : value === "");
        if (empty) {
          decided.set(f.id, none(f, NOTES.noAnswer));
          continue;
        }
        const isDraft = f.type === "textarea" && String(value).length > 80;
        decided.set(f.id, {
          id: f.id,
          value: value!,
          source: "ai",
          confidence: isDraft && answer!.confidence === "high" ? "medium" : answer!.confidence,
          ...(isDraft ? { note: NOTES.draft } : {}),
        });
      }
    }
  }

  return {
    job: job
      ? { id: job.id, title: job.title, company: job.company, status: job.status }
      : null,
    resume: ctx.resume
      ? {
          id: ctx.resume.id,
          title: ctx.resume.title,
          hasFile: ctx.resume.hasFile,
          ...(ctx.resume.fileName ? { fileName: ctx.resume.fileName } : {}),
        }
      : null,
    values: fields.map((f) => decided.get(f.id) ?? none(f, NOTES.noAnswer)),
    warnings,
  };
}
