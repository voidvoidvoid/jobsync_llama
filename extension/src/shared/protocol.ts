import type {
  AutofillField,
  AutofillJobRef,
  AutofillSource,
  AutofillValue,
} from "../../../src/lib/autofill/types";

export const PORT_NAME = "jobsync-autofill";

// A field as scanned in one frame; id is frame-local until the background
// prefixes it with the frame id.
export interface ScannedField extends AutofillField {
  hasValue: boolean;
}

export interface ScanResult {
  url: string;
  title: string;
  pageText: string;
  fields: ScannedField[];
}

export interface ResumeFilePayload {
  name: string;
  type: string;
  base64: string;
}

export interface ApplyOutcome {
  id: string;
  ok: boolean;
  error?: string;
}

export interface CollectedValue {
  id: string;
  value: string | string[];
}

export interface PanelItem {
  id: string;
  label: string;
  display: string;
  source: AutofillSource | "kept";
  note?: string;
  error?: string;
}

export interface AnswerCandidate {
  id: string;
  question: string;
  answer: string;
}

export interface PanelState {
  phase: "working" | "done" | "error";
  message: string;
  job: AutofillJobRef | null;
  items: PanelItem[];
  warnings: string[];
  // Guess for adding an unsaved job to JobSync as Applied
  jobGuess?: { jobTitle: string; company: string };
}

// panel -> background
export type PanelRequest =
  | { type: "ping" }
  | { type: "focus"; id: string }
  | { type: "review-answers" }
  | { type: "save-answers"; answers: Array<{ question: string; answer: string }> }
  | { type: "mark-applied"; jobTitle?: string; company?: string }
  | { type: "close" };

// background -> panel
export type PanelEvent =
  | { type: "state"; state: PanelState }
  | { type: "answer-candidates"; candidates: AnswerCandidate[] }
  | { type: "notice"; ok: boolean; message: string };

export type { AutofillValue };
