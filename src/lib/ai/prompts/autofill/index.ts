import type { AutofillField } from "@/lib/autofill/types";

export const AUTOFILL_SYSTEM_PROMPT = `You fill in a job application form for a candidate. The candidate reviews every answer before submitting, so leave a field empty rather than guess.

You get the candidate's profile, resume and saved answers, the job description, and a JSON list of form fields. Answer each field using ONLY those facts.

RULES
- Never invent employers, job titles, dates, degrees, certifications, numbers, addresses or links.
- For a field with "options", the value MUST be one of the options, copied exactly. For "checkbox-group" give an array of options. For "checkbox" give "yes" or "no".
- For "date" give YYYY-MM-DD. For "number" give digits only.
- Short factual fields (city, country, current title, current employer, years of experience, degree, school, notice period): answer from the facts, briefly.
- Open questions in a "textarea" (why this company, describe a project, anything else to share): write a concise first-person answer grounded in the resume and the job description, under 120 words and within maxLength if given. Plain text, no greeting or sign-off.
- If the facts do not answer a field, give "" as its value. Never answer about demographics, disability, veteran status, work authorization, visas, salary, criminal history or legal consent.
- confidence: "high" if a fact states the answer directly, "medium" if you inferred or wrote it, "low" if unsure.

OUTPUT
Return ONLY a JSON object, no markdown fences and no other text:
{"answers":[{"id":"<field id>","value":"<answer>","confidence":"high"}]}
Include every field id you were given, in the same order.`;

// The model gets the fields without page noise, in a compact form
function compactField(f: AutofillField) {
  return {
    id: f.id,
    label: f.label,
    type: f.type,
    ...(f.options && f.options.length > 0 ? { options: f.options } : {}),
    ...(f.placeholder ? { placeholder: f.placeholder } : {}),
    ...(f.maxLength ? { maxLength: f.maxLength } : {}),
    ...(f.required ? { required: true } : {}),
  };
}

export function buildAutofillPrompt(input: {
  profileLines: string[];
  resumeText: string;
  savedAnswers: Array<{ question: string; answer: string }>;
  jobTitle?: string;
  jobDescription: string;
  fields: AutofillField[];
  today: string;
}): string {
  const answers =
    input.savedAnswers.length > 0
      ? input.savedAnswers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n")
      : "(none)";
  return `TODAY: ${input.today}

CANDIDATE PROFILE
${input.profileLines.join("\n") || "(none)"}

RESUME
${input.resumeText || "(no resume)"}

SAVED ANSWERS (the candidate's own answers to earlier forms)
${answers}

JOB${input.jobTitle ? ` (${input.jobTitle})` : ""}
${input.jobDescription || "(no description available)"}

FORM FIELDS
${JSON.stringify(input.fields.map(compactField))}`;
}
