import type { AutofillFieldType } from "../../../src/lib/autofill/types";
import type { ScannedField } from "../shared/protocol";

export const ID_ATTR = "data-jobsync-af";
export const PANEL_HOST_ID = "jobsync-autofill-panel";

// Elements behind one scanned field: a radio or checkbox group has several
export interface FieldHandle {
  field: ScannedField;
  elements: HTMLElement[];
  // Element to outline in the page
  frame: HTMLElement;
}

const SKIP_INPUT_TYPES = new Set([
  "hidden", "submit", "button", "reset", "image", "password", "search", "range", "color",
]);
const SKIP_TEXT_TAGS = new Set(["SELECT", "OPTION", "TEXTAREA", "SCRIPT", "STYLE", "NOSCRIPT", "SVG", "INPUT", "BUTTON"]);
const FIELD_SELECTOR = "input, textarea, select, [role='combobox']";

export function cleanLabel(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\*/g, "")
    .replace(/\((?:required|optional)\)/gi, "")
    .replace(/\s+required$/i, "")
    .trim()
    .slice(0, 300);
}

// Visible text of an element without the text of nested form controls
export function textOf(node: Node | null): string {
  if (!node) return "";
  let out = "";
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) out += child.textContent ?? "";
    else if (child.nodeType === 1) {
      const el = child as Element;
      if (SKIP_TEXT_TAGS.has(el.tagName.toUpperCase())) return;
      if (el.getAttribute("aria-hidden") === "true") return;
      out += " " + textOf(el) + " ";
    }
  });
  return out.replace(/\s+/g, " ").trim();
}

function styleHidden(el: Element): boolean {
  const st = el.ownerDocument.defaultView?.getComputedStyle(el);
  return !!st && (st.display === "none" || st.visibility === "hidden");
}

export function isHidden(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.id === PANEL_HOST_ID) return true;
    if ((n as HTMLElement).hidden) return true;
    if (n.getAttribute("aria-hidden") === "true" && n !== el) return true;
    if (styleHidden(n)) return true;
  }
  return false;
}

function byIds(doc: Document, ids: string | null): string {
  if (!ids) return "";
  return ids
    .split(/\s+/)
    .map((id) => textOf(doc.getElementById(id)))
    .filter(Boolean)
    .join(" ");
}

function hasControl(el: Element): boolean {
  return el.matches(FIELD_SELECTOR) || !!el.querySelector(FIELD_SELECTOR);
}

// The nearest text before the field in the page: a label-like element in a
// wrapper above it, stopping at the previous question.
export function contextText(el: Element): string {
  let child: Element = el;
  for (let depth = 0; depth < 5 && child.parentElement; depth++) {
    const parent = child.parentElement;
    for (let sib = child.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (hasControl(sib)) return "";
      const t = cleanLabel(textOf(sib));
      if (t) return t;
    }
    // Text directly in the wrapper, before the field ("Name <input>")
    let direct = "";
    for (const node of Array.from(parent.childNodes)) {
      if (node === child) break;
      if (node.nodeType === 3) direct += node.textContent ?? "";
    }
    if (cleanLabel(direct)) return cleanLabel(direct);
    child = parent;
  }
  return "";
}

function ownLabel(el: HTMLElement): string {
  const doc = el.ownerDocument;
  const aria = byIds(doc, el.getAttribute("aria-labelledby"));
  if (aria) return aria;
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length > 0) {
    const t = Array.from(labels).map((l) => textOf(l)).filter(Boolean).join(" ");
    if (t) return t;
  }
  const wrap = el.closest("label");
  if (wrap) {
    const t = textOf(wrap);
    if (t) return t;
  }
  return el.getAttribute("aria-label") ?? "";
}

export function labelFor(el: HTMLElement): { label: string; required: boolean } {
  const raw =
    ownLabel(el) ||
    contextText(el) ||
    el.getAttribute("placeholder") ||
    el.getAttribute("title") ||
    (el.getAttribute("name") ?? "").replace(/[_\-[\]]+/g, " ");
  const required =
    (el as HTMLInputElement).required === true ||
    el.getAttribute("aria-required") === "true" ||
    /\*/.test(raw);
  return { label: cleanLabel(raw), required };
}

// Label of one radio or checkbox in a group: its own label, else the text
// right after it, else its value
function optionLabel(el: HTMLInputElement): string {
  const own = cleanLabel(ownLabel(el));
  if (own) return own;
  const next = el.nextSibling;
  const t = cleanLabel(next ? (next.nodeType === 3 ? next.textContent ?? "" : textOf(next)) : "");
  return t || el.value;
}

function commonAncestor(els: Element[]): Element {
  let anc: Element = els[0].parentElement ?? els[0];
  while (anc.parentElement && !els.every((e) => anc.contains(e))) {
    anc = anc.parentElement;
  }
  return anc;
}

// Text inside the group's wrapper before its first choice ("<p>Languages</p>
// <label><input> Python</label>...")
function leadingText(container: Element, first: Element): string {
  let text = "";
  for (const child of Array.from(container.children)) {
    if (child.contains(first)) break;
    if (hasControl(child)) {
      text = "";
      continue;
    }
    const t = cleanLabel(textOf(child));
    if (t) text = t;
  }
  return text;
}

function groupLabel(els: HTMLInputElement[], container: Element): { label: string; required: boolean } {
  const doc = container.ownerDocument;
  const fieldset = els[0].closest("fieldset");
  const legend = fieldset?.querySelector("legend");
  const group = els[0].closest("[role='radiogroup'], [role='group']");
  const raw =
    (legend ? textOf(legend) : "") ||
    (group
      ? byIds(doc, group.getAttribute("aria-labelledby")) || group.getAttribute("aria-label") || ""
      : "") ||
    leadingText(container, els[0]) ||
    contextText(container) ||
    (els[0].name ?? "").replace(/[_\-[\]]+/g, " ");
  const required =
    els.some((e) => e.required || e.getAttribute("aria-required") === "true") ||
    group?.getAttribute("aria-required") === "true" ||
    /\*/.test(raw);
  return { label: cleanLabel(raw), required };
}

function inputType(el: HTMLInputElement): AutofillFieldType {
  const t = (el.getAttribute("type") ?? "text").toLowerCase();
  if (["email", "tel", "url", "number", "date", "file", "radio", "checkbox"].includes(t)) {
    return t as AutofillFieldType;
  }
  return "text";
}

function choiceHidden(el: HTMLInputElement): boolean {
  if (!isHidden(el)) return false;
  const label = el.labels?.[0] ?? el.closest("label");
  return !label || isHidden(label);
}

// A combobox (react-select and similar) shows its chosen value next to the
// input, not in it
function comboboxHasValue(el: HTMLElement): boolean {
  if ((el as HTMLInputElement).value) return true;
  let box: Element | null = el;
  for (let i = 0; i < 4 && box; i++) box = box.parentElement;
  return !!box?.querySelector("[class*='single-value'], [class*='singleValue']");
}

function comboboxOptions(el: HTMLElement): string[] {
  const doc = el.ownerDocument;
  const list = doc.getElementById(el.getAttribute("aria-controls") ?? "");
  if (!list) return [];
  return Array.from(list.querySelectorAll("[role='option']"))
    .map((o) => cleanLabel(textOf(o)))
    .filter(Boolean);
}

// Reads every fillable question in the document and tags its elements so
// later calls can find them again.
export function scanDocument(doc: Document): FieldHandle[] {
  const handles: FieldHandle[] = [];
  const seen = new Set<Element>();
  const groups = new Map<string, HTMLInputElement[]>();
  let n = 0;
  const nextId = () => `f${++n}`;

  const all = Array.from(doc.querySelectorAll<HTMLElement>(FIELD_SELECTOR));
  for (const el of all) {
    if (seen.has(el)) continue;
    seen.add(el);
    if ((el as HTMLInputElement).disabled) continue;
    if (el.closest(`#${PANEL_HOST_ID}`)) continue;

    const tag = el.tagName.toUpperCase();
    const role = el.getAttribute("role");

    if (tag === "INPUT" && role !== "combobox") {
      const input = el as HTMLInputElement;
      const type = (input.getAttribute("type") ?? "text").toLowerCase();
      if (SKIP_INPUT_TYPES.has(type)) continue;
      if (type === "radio" || type === "checkbox") {
        if (choiceHidden(input)) continue;
        const key = `${type}:${input.name || "__" + nextId()}`;
        const list = groups.get(key) ?? [];
        list.push(input);
        groups.set(key, list);
        continue;
      }
      if (type === "file") {
        // Upload inputs are usually hidden behind a styled button
        const id = nextId();
        input.setAttribute(ID_ATTR, id);
        const { label, required } = labelFor(input);
        let frame: HTMLElement = input;
        while (frame.parentElement && isHidden(frame)) frame = frame.parentElement;
        handles.push({
          field: {
            id,
            label: label || "Upload",
            type: "file",
            required,
            name: input.name || undefined,
            accept: input.accept || undefined,
            hasValue: (input.files?.length ?? 0) > 0,
          },
          elements: [input],
          frame,
        });
        continue;
      }
      if (isHidden(input) || input.readOnly) continue;
    } else if (isHidden(el)) {
      continue;
    }

    const id = nextId();
    el.setAttribute(ID_ATTR, id);
    const { label, required } = labelFor(el);
    if (!label) continue;

    let type: AutofillFieldType;
    let options: string[] | undefined;
    let hasValue: boolean;
    if (role === "combobox" && tag !== "SELECT") {
      type = "combobox";
      options = comboboxOptions(el);
      hasValue = comboboxHasValue(el);
    } else if (tag === "SELECT") {
      const sel = el as HTMLSelectElement;
      type = "select";
      options = Array.from(sel.options)
        .filter((o) => o.value !== "" && !/^(?:select|choose|please select|--)/i.test(o.text.trim()))
        .map((o) => cleanLabel(o.text))
        .filter(Boolean);
      hasValue = sel.value !== "" && !/^(?:select|choose|please select|--)/i.test(sel.selectedOptions[0]?.text.trim() ?? "");
    } else if (tag === "TEXTAREA") {
      type = "textarea";
      hasValue = (el as HTMLTextAreaElement).value.trim() !== "";
    } else {
      type = inputType(el as HTMLInputElement);
      hasValue = (el as HTMLInputElement).value.trim() !== "";
    }

    const maxLength = (el as HTMLInputElement).maxLength;
    handles.push({
      field: {
        id,
        label,
        type,
        ...(options && options.length > 0 ? { options } : {}),
        required,
        name: el.getAttribute("name") || undefined,
        autocomplete: el.getAttribute("autocomplete") || undefined,
        placeholder: el.getAttribute("placeholder") || undefined,
        ...(maxLength && maxLength > 0 && maxLength < 100000 ? { maxLength } : {}),
        hasValue,
      },
      elements: [el],
      frame: el,
    });
  }

  for (const [key, els] of groups) {
    const kind = key.startsWith("radio") ? "radio" : "checkbox";
    const id = nextId();
    els.forEach((e) => e.setAttribute(ID_ATTR, id));
    const container = els.length > 1 ? commonAncestor(els) : els[0].parentElement ?? els[0];
    if (kind === "checkbox" && els.length === 1) {
      const { label, required } = labelFor(els[0]);
      if (!label) continue;
      handles.push({
        field: { id, label, type: "checkbox", required, name: els[0].name || undefined, hasValue: els[0].checked },
        elements: els,
        frame: (els[0].closest("label") as HTMLElement) ?? els[0],
      });
      continue;
    }
    const { label, required } = groupLabel(els, container);
    const options = els.map(optionLabel);
    if (!label) continue;
    handles.push({
      field: {
        id,
        label,
        type: kind === "radio" ? "radio" : "checkbox-group",
        options,
        required,
        name: els[0].name || undefined,
        hasValue: els.some((e) => e.checked),
      },
      elements: els,
      frame: container as HTMLElement,
    });
  }

  // Keep page order, which the review panel follows
  handles.sort((a, b) => {
    const pos = a.elements[0].compareDocumentPosition(b.elements[0]);
    return pos & 4 ? -1 : pos & 2 ? 1 : 0;
  });
  return handles;
}

export function pageText(doc: Document, limit = 20000): string {
  const body = doc.body;
  if (!body) return "";
  const text = (body as HTMLElement).innerText ?? textOf(body);
  return (text || textOf(body)).replace(/\n{3,}/g, "\n\n").slice(0, limit);
}
