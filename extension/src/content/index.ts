import type { AutofillSource, AutofillValue } from "../../../src/lib/autofill/types";
import type { ApplyOutcome, CollectedValue, ResumeFilePayload, ScanResult } from "../shared/protocol";
import { applyValue, clearHighlights, highlight, readValue } from "./apply";
import { pageText, scanDocument, type FieldHandle } from "./extract";
import { Panel } from "./panel";

// Injected into every frame of the tab when the toolbar button is clicked.
// The background calls these through scripting.executeScript.

declare global {
  interface Window {
    __jobsyncAutofill?: ContentApi;
  }
}

export interface ContentApi {
  start(): void;
  scan(): ScanResult;
  apply(values: AutofillValue[], file: ResumeFilePayload | null): Promise<ApplyOutcome[]>;
  markKept(ids: string[]): void;
  collect(): CollectedValue[];
  focus(id: string): boolean;
  clear(): void;
}

function create(): ContentApi {
  let handles = new Map<string, FieldHandle>();
  let panel: Panel | null = null;

  return {
    start() {
      panel?.close();
      panel = new Panel();
      panel.connect();
    },
    scan() {
      clearHighlights(document);
      handles = new Map(scanDocument(document).map((h) => [h.field.id, h]));
      return {
        url: location.href,
        title: document.title,
        pageText: window === window.top ? pageText(document) : "",
        fields: [...handles.values()].map((h) => h.field),
      };
    },
    async apply(values, file) {
      const out: ApplyOutcome[] = [];
      for (const v of values) {
        const handle = handles.get(v.id);
        if (!handle) continue;
        highlight(handle, v.source as AutofillSource);
        const empty = Array.isArray(v.value) ? v.value.length === 0 : v.value === "";
        if (v.source === "none" || empty) continue;
        out.push(await applyValue(handle, v.value, v.source === "resume" ? file : null));
      }
      return out;
    },
    markKept(ids) {
      for (const id of ids) {
        const handle = handles.get(id);
        if (handle) highlight(handle, "kept");
      }
    },
    collect() {
      return [...handles.values()].map(readValue);
    },
    focus(id) {
      const handle = handles.get(id);
      if (!handle) return false;
      handle.frame.scrollIntoView({ behavior: "smooth", block: "center" });
      handle.elements[0].focus?.({ preventScroll: true });
      return true;
    },
    clear() {
      clearHighlights(document);
    },
  };
}

if (!window.__jobsyncAutofill) {
  window.__jobsyncAutofill = create();
}
