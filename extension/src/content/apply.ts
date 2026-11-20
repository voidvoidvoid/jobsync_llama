import type { AutofillSource } from "../../../src/lib/autofill/types";
import type { ApplyOutcome, CollectedValue, ResumeFilePayload } from "../shared/protocol";
import { cleanLabel, textOf, type FieldHandle } from "./extract";

export function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function setNativeValue(el: HTMLElement, value: string) {
  const view = el.ownerDocument.defaultView ?? window;
  const proto =
    el.tagName === "TEXTAREA"
      ? view.HTMLTextAreaElement.prototype
      : el.tagName === "SELECT"
        ? view.HTMLSelectElement.prototype
        : view.HTMLInputElement.prototype;
  // Frameworks such as React track the value through the prototype setter;
  // assigning el.value directly would be overwritten on the next render.
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else (el as HTMLInputElement).value = value;
}

function fire(el: HTMLElement, ...types: string[]) {
  const view = el.ownerDocument.defaultView ?? window;
  for (const type of types) el.dispatchEvent(new view.Event(type, { bubbles: true }));
}

function setText(el: HTMLElement, value: string) {
  el.focus?.();
  setNativeValue(el, value);
  fire(el, "input", "change");
  el.blur?.();
}

function pick<T>(items: T[], text: (t: T) => string, wanted: string): T | undefined {
  const w = norm(wanted);
  return (
    items.find((i) => norm(text(i)) === w) ??
    items.find((i) => {
      const t = norm(text(i));
      return t.length > 0 && (t.startsWith(w) || w.startsWith(t));
    })
  );
}

function setSelect(el: HTMLSelectElement, value: string): boolean {
  const opts = Array.from(el.options);
  const opt = pick(opts, (o) => o.text, value) ?? opts.find((o) => o.value === value);
  if (!opt) return false;
  setNativeValue(el, opt.value);
  fire(el, "input", "change");
  return true;
}

function choiceLabel(el: HTMLInputElement): string {
  const own = el.labels?.[0] ?? el.closest("label");
  if (own) return cleanLabel(textOf(own));
  const next = el.nextSibling;
  return cleanLabel(next ? textOf(next) || next.textContent || "" : "") || el.value;
}

function setChoices(els: HTMLInputElement[], wanted: string[]): boolean {
  let ok = false;
  for (const w of wanted) {
    const target = pick(els, choiceLabel, w);
    if (!target) continue;
    ok = true;
    if (!target.checked) target.click();
  }
  return ok;
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function setCombobox(el: HTMLElement, value: string): Promise<boolean> {
  const doc = el.ownerDocument;
  el.focus?.();
  fire(el, "mousedown");
  setNativeValue(el, value);
  fire(el, "input", "change");
  // The listbox appears after the input event; wait for a matching option
  for (let i = 0; i < 15; i++) {
    await wait(100);
    const listId = el.getAttribute("aria-controls");
    const scope = (listId && doc.getElementById(listId)) || doc;
    const options = Array.from(scope.querySelectorAll<HTMLElement>("[role='option']"));
    const opt = pick(options, (o) => textOf(o), value);
    if (opt) {
      fire(opt, "mousedown", "mouseup");
      opt.click();
      return true;
    }
  }
  const view = doc.defaultView ?? window;
  el.dispatchEvent(new view.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  return false;
}

function setFile(el: HTMLInputElement, file: ResumeFilePayload): boolean {
  const view = el.ownerDocument.defaultView ?? window;
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  const f = new view.File([bytes], file.name, { type: file.type });
  const dt = new view.DataTransfer();
  dt.items.add(f);
  el.files = dt.files;
  fire(el, "input", "change");
  return (el.files?.length ?? 0) > 0;
}

export async function applyValue(
  handle: FieldHandle,
  value: string | string[],
  file: ResumeFilePayload | null,
): Promise<ApplyOutcome> {
  const { field, elements } = handle;
  const el = elements[0];
  const text = Array.isArray(value) ? value.join(", ") : value;
  try {
    let ok = true;
    switch (field.type) {
      case "file":
        if (!file) return { id: field.id, ok: false, error: "No file to attach" };
        ok = setFile(el as HTMLInputElement, file);
        break;
      case "select":
        ok = setSelect(el as HTMLSelectElement, text);
        break;
      case "radio":
        ok = setChoices(elements as HTMLInputElement[], [text]);
        break;
      case "checkbox-group":
        ok = setChoices(elements as HTMLInputElement[], Array.isArray(value) ? value : [value]);
        break;
      case "checkbox": {
        const box = el as HTMLInputElement;
        const want = text === "yes";
        if (box.checked !== want) box.click();
        break;
      }
      case "combobox":
        ok = await setCombobox(el, text);
        break;
      default:
        setText(el, text);
    }
    return ok ? { id: field.id, ok } : { id: field.id, ok, error: "Could not choose that option" };
  } catch (error) {
    return { id: field.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function readValue(handle: FieldHandle): CollectedValue {
  const { field, elements } = handle;
  const el = elements[0];
  let value: string | string[] = "";
  switch (field.type) {
    case "select": {
      const sel = el as HTMLSelectElement;
      value = sel.value ? cleanLabel(sel.selectedOptions[0]?.text ?? "") : "";
      break;
    }
    case "radio":
      value = (elements as HTMLInputElement[]).filter((e) => e.checked).map(choiceLabel)[0] ?? "";
      break;
    case "checkbox-group":
      value = (elements as HTMLInputElement[]).filter((e) => e.checked).map(choiceLabel);
      break;
    case "checkbox":
      value = (el as HTMLInputElement).checked ? "yes" : "no";
      break;
    case "file":
      value = (el as HTMLInputElement).files?.[0]?.name ?? "";
      break;
    case "combobox": {
      value = (el as HTMLInputElement).value ?? "";
      if (!value) {
        let box: Element | null = el;
        for (let i = 0; i < 4 && box; i++) box = box.parentElement;
        const chosen = box?.querySelector("[class*='single-value'], [class*='singleValue']");
        value = chosen ? cleanLabel(textOf(chosen)) : "";
      }
      break;
    }
    default:
      value = (el as HTMLInputElement).value ?? "";
  }
  return { id: field.id, value };
}

const COLORS: Record<AutofillSource | "kept", string> = {
  profile: "#16a34a",
  answer: "#16a34a",
  resume: "#16a34a",
  kept: "#16a34a",
  ai: "#ca8a04",
  none: "#dc2626",
};
const OUTLINE_ATTR = "data-jobsync-af-outline";

export function highlight(handle: FieldHandle, source: AutofillSource | "kept") {
  const el = handle.frame;
  if (!el.hasAttribute(OUTLINE_ATTR)) {
    el.setAttribute(OUTLINE_ATTR, `${el.style.outline}|${el.style.outlineOffset}`);
  }
  el.style.outline = `2px solid ${COLORS[source]}`;
  el.style.outlineOffset = "2px";
}

export function clearHighlights(doc: Document) {
  doc.querySelectorAll<HTMLElement>(`[${OUTLINE_ATTR}]`).forEach((el) => {
    const [outline, offset] = (el.getAttribute(OUTLINE_ATTR) ?? "|").split("|");
    el.style.outline = outline;
    el.style.outlineOffset = offset;
    el.removeAttribute(OUTLINE_ATTR);
  });
}
