// Shared by the JobSync API and the Firefox extension (extension/). Keep this
// file free of imports so the extension bundle can use it as-is.

export type AutofillFieldType =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "number"
  | "date"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "checkbox-group"
  | "combobox"
  | "file";

// One question on an application form, as the extension read it.
export interface AutofillField {
  // "<frameId>:<local id>", unique within one scan of a tab
  id: string;
  label: string;
  type: AutofillFieldType;
  // Choices for select, radio, checkbox-group and (when visible) combobox
  options?: string[];
  required?: boolean;
  name?: string;
  autocomplete?: string;
  placeholder?: string;
  maxLength?: number;
  // file inputs: the accept attribute
  accept?: string;
}

export type AutofillSource = "profile" | "answer" | "ai" | "resume" | "none";
export type AutofillConfidence = "high" | "medium" | "low";

// What to put in one field. value is "" when JobSync has no answer; a
// checkbox takes "yes" or "no"; a checkbox-group takes the options to tick.
export interface AutofillValue {
  id: string;
  value: string | string[];
  source: AutofillSource;
  confidence: AutofillConfidence;
  // Shown in the review panel, e.g. why a field was left for the user
  note?: string;
  // Recognized question kind, e.g. "sponsorship" (see classify.ts)
  topic?: string;
}

export interface AutofillFillRequest {
  url: string;
  // URLs of frames holding form fields (an embedded Greenhouse form, say)
  frameUrls?: string[];
  title?: string;
  // Visible text of the page, used as the job description when the job is
  // not saved in JobSync
  pageText?: string;
  fields: AutofillField[];
}

export interface AutofillJobRef {
  id: string;
  title: string;
  company: string;
  status: string;
}

export interface AutofillResumeRef {
  id: string;
  title: string;
  hasFile: boolean;
  fileName?: string;
}

export interface AutofillFillResponse {
  job: AutofillJobRef | null;
  resume: AutofillResumeRef | null;
  values: AutofillValue[];
  warnings: string[];
}

export interface AutofillAnswerInput {
  question: string;
  answer: string;
}

export interface SavedAnswer {
  id: string;
  question: string;
  answer: string;
  updatedAt: string;
}

export const AUTOFILL_LIMITS = {
  maxFields: 120,
  maxOptions: 300,
  maxLabel: 300,
  maxPageText: 20000,
  maxAnswers: 300,
  maxQuestion: 300,
  maxAnswer: 2000,
} as const;
