import { ext } from "../webext";
import {
  PORT_NAME,
  type AnswerCandidate,
  type PanelEvent,
  type PanelRequest,
  type PanelState,
} from "../shared/protocol";
import { PANEL_HOST_ID } from "./extract";

// The review panel lives in the top frame, in a shadow root so the page's
// styles cannot reach it. It talks to the background over one port, which
// also keeps the background awake while a slow local model works.

const CSS = `
:host { all: initial; }
.panel { position: fixed; top: 16px; right: 16px; z-index: 2147483647; width: 360px; max-height: calc(100vh - 32px);
  display: flex; flex-direction: column; background: #fff; color: #111; border: 1px solid #d4d4d8; border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.18); font: 13px/1.4 system-ui, sans-serif; }
@media (prefers-color-scheme: dark) { .panel { background: #18181b; color: #f4f4f5; border-color: #3f3f46; } .item:hover { background: #27272a !important; } input { background: #27272a; color: #f4f4f5; } }
header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid rgba(127,127,127,.25); }
header strong { font-size: 14px; }
button { font: inherit; cursor: pointer; border-radius: 6px; border: 1px solid rgba(127,127,127,.4); background: transparent; color: inherit; padding: 5px 10px; }
button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
button:disabled { opacity: .5; cursor: default; }
.x { border: none; font-size: 18px; padding: 0 4px; line-height: 1; }
.body { overflow: auto; padding: 8px 12px; }
.status { margin: 4px 0 8px; }
.job { font-size: 12px; opacity: .85; margin-bottom: 8px; }
.counts { display: flex; gap: 10px; font-size: 12px; margin-bottom: 8px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
.green { background: #16a34a; } .yellow { background: #ca8a04; } .red { background: #dc2626; }
.item { display: block; width: 100%; text-align: left; border: none; border-radius: 6px; padding: 6px; margin: 0; }
.item:hover { background: #f4f4f5; }
.label { font-weight: 600; display: flex; gap: 6px; align-items: baseline; }
.value { opacity: .85; white-space: pre-wrap; word-break: break-word; max-height: 4.2em; overflow: hidden; }
.note { font-size: 11px; opacity: .75; }
.err { font-size: 11px; color: #dc2626; }
.warn { font-size: 12px; color: #b45309; margin: 4px 0; }
footer { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px; border-top: 1px solid rgba(127,127,127,.25); }
.notice { font-size: 12px; padding: 0 12px 8px; }
label.cand { display: flex; gap: 6px; align-items: flex-start; margin: 6px 0; }
.form input { width: 100%; box-sizing: border-box; margin: 2px 0 6px; padding: 4px 6px; border: 1px solid rgba(127,127,127,.4); border-radius: 6px; font: inherit; }
.spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: s .8s linear infinite; vertical-align: -2px; margin-right: 6px; }
@keyframes s { to { transform: rotate(360deg); } }
`;

const DOTS: Record<string, string> = {
  profile: "green", answer: "green", resume: "green", kept: "green", ai: "yellow", none: "red",
};
const SOURCE_TEXT: Record<string, string> = {
  profile: "profile", answer: "saved answer", resume: "resume file", kept: "already filled", ai: "AI", none: "needs you",
};

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export class Panel {
  private host: HTMLElement;
  private root: ShadowRoot;
   
  private port: any;
  private ping: ReturnType<typeof setInterval> | undefined;
  private state: PanelState = { phase: "working", message: "Reading the form...", job: null, items: [], warnings: [] };
  private view: "list" | "answers" | "applied" = "list";
  private candidates: AnswerCandidate[] = [];
  private notice: { ok: boolean; message: string } | null = null;
  private busy = false;

  constructor() {
    document.getElementById(PANEL_HOST_ID)?.remove();
    this.host = h("div", { id: PANEL_HOST_ID });
    this.root = this.host.attachShadow({ mode: "open" });
    document.documentElement.append(this.host);
    this.render();
  }

  connect() {
    this.port = ext.runtime.connect({ name: PORT_NAME });
    this.port.onMessage.addListener((e: PanelEvent) => this.onEvent(e));
    this.port.onDisconnect.addListener(() => {
      if (this.ping) clearInterval(this.ping);
    });
    this.ping = setInterval(() => this.send({ type: "ping" }), 20000);
  }

  private send(msg: PanelRequest) {
    try {
      this.port?.postMessage(msg);
    } catch {
      // The background reloaded; the panel stays readable
    }
  }

  private onEvent(e: PanelEvent) {
    if (e.type === "state") {
      this.state = e.state;
    } else if (e.type === "answer-candidates") {
      this.candidates = e.candidates;
      this.view = "answers";
      this.busy = false;
    } else if (e.type === "notice") {
      this.notice = { ok: e.ok, message: e.message };
      this.busy = false;
      if (e.ok) this.view = "list";
    }
    this.render();
  }

  close() {
    this.send({ type: "close" });
    if (this.ping) clearInterval(this.ping);
    try {
      this.port?.disconnect();
    } catch {
      // already gone
    }
    this.host.remove();
  }

  private render() {
    const s = this.state;
    const count = (src: string[]) => s.items.filter((i) => src.includes(i.source)).length;
    const head = h(
      "header",
      {},
      h("strong", {}, "JobSync Autofill"),
      (() => {
        const x = h("button", { class: "x", title: "Close", "aria-label": "Close" }, "×");
        x.onclick = () => this.close();
        return x;
      })(),
    );

    const body = h("div", { class: "body" });
    body.append(
      h(
        "div",
        { class: "status" },
        s.phase === "working" ? h("span", { class: "spinner" }) : null,
        s.message,
      ),
    );
    if (s.job) {
      body.append(h("div", { class: "job" }, `In JobSync: ${s.job.title} at ${s.job.company} (${s.job.status})`));
    } else if (s.phase === "done") {
      body.append(h("div", { class: "job" }, "This job is not saved in JobSync."));
    }
    for (const w of s.warnings) body.append(h("div", { class: "warn" }, w));

    if (this.view === "list") this.renderList(body, count);
    else if (this.view === "answers") this.renderAnswers(body);
    else this.renderApplied(body);

    const foot = h("footer");
    if (s.phase === "done" && this.view === "list") {
      const remember = h("button", {}, "Remember my answers");
      remember.disabled = this.busy;
      remember.onclick = () => {
        this.busy = true;
        this.notice = null;
        this.send({ type: "review-answers" });
        this.render();
      };
      const applied = h("button", { class: "primary" }, "Mark as applied");
      applied.disabled = this.busy;
      applied.onclick = () => {
        this.notice = null;
        if (s.job) {
          this.busy = true;
          this.send({ type: "mark-applied" });
        } else {
          this.view = "applied";
        }
        this.render();
      };
      foot.append(remember, applied);
    }

    const children: Node[] = [h("style", {}, CSS)];
    const panel = h("div", { class: "panel", role: "dialog", "aria-label": "JobSync Autofill" }, head, body);
    if (this.notice) {
      panel.append(h("div", { class: "notice", style: `color:${this.notice.ok ? "#16a34a" : "#dc2626"}` }, this.notice.message));
    }
    if (foot.childElementCount > 0) panel.append(foot);
    children.push(panel);
    this.root.replaceChildren(...children);
  }

  private renderList(body: HTMLElement, count: (src: string[]) => number) {
    const s = this.state;
    if (s.items.length === 0) return;
    body.append(
      h(
        "div",
        { class: "counts" },
        h("span", {}, h("span", { class: "dot green" }), `${count(["profile", "answer", "resume", "kept"])} from you`),
        h("span", {}, h("span", { class: "dot yellow" }), `${count(["ai"])} AI`),
        h("span", {}, h("span", { class: "dot red" }), `${count(["none"])} need you`),
      ),
    );
    for (const item of s.items) {
      const btn = h(
        "button",
        { class: "item", title: "Show in the form" },
        h(
          "div",
          { class: "label" },
          h("span", { class: `dot ${DOTS[item.source] ?? "red"}` }),
          item.label,
        ),
        item.display ? h("div", { class: "value" }, item.display) : null,
        h("div", { class: "note" }, [SOURCE_TEXT[item.source], item.note].filter(Boolean).join(" · ")),
        item.error ? h("div", { class: "err" }, `Not filled: ${item.error}`) : null,
      );
      btn.onclick = () => this.send({ type: "focus", id: item.id });
      body.append(btn);
    }
  }

  private renderAnswers(body: HTMLElement) {
    if (this.candidates.length === 0) {
      body.append(h("p", {}, "Nothing new to remember: you have not typed or changed any answers JobSync could reuse."));
    } else {
      body.append(h("p", {}, "Save these answers to JobSync so future forms fill them in:"));
    }
    const boxes: Array<[HTMLInputElement, AnswerCandidate]> = [];
    for (const c of this.candidates) {
      const box = h("input", { type: "checkbox" });
      box.checked = true;
      boxes.push([box, c]);
      body.append(
        h("label", { class: "cand" }, box, h("span", {}, h("strong", {}, c.question), h("br"), c.answer)),
      );
    }
    const row = h("div", { class: "form" });
    const back = h("button", {}, "Back");
    back.onclick = () => {
      this.view = "list";
      this.render();
    };
    row.append(back);
    if (this.candidates.length > 0) {
      const save = h("button", { class: "primary", style: "margin-left:6px" }, "Save selected");
      save.disabled = this.busy;
      save.onclick = () => {
        const answers = boxes.filter(([b]) => b.checked).map(([, c]) => ({ question: c.question, answer: c.answer }));
        if (answers.length === 0) return;
        this.busy = true;
        this.send({ type: "save-answers", answers });
        this.render();
      };
      row.append(save);
    }
    body.append(row);
  }

  private renderApplied(body: HTMLElement) {
    const guess = this.state.jobGuess ?? { jobTitle: "", company: "" };
    const title = h("input", { "aria-label": "Job title" });
    title.value = guess.jobTitle;
    const company = h("input", { "aria-label": "Company" });
    company.value = guess.company;
    const save = h("button", { class: "primary" }, "Add to JobSync as Applied");
    save.disabled = this.busy;
    save.onclick = () => {
      if (!title.value.trim() || !company.value.trim()) return;
      this.busy = true;
      this.send({ type: "mark-applied", jobTitle: title.value.trim(), company: company.value.trim() });
      this.render();
    };
    const back = h("button", { style: "margin-left:6px" }, "Back");
    back.onclick = () => {
      this.view = "list";
      this.render();
    };
    body.append(
      h("div", { class: "form" }, h("p", {}, "Add this job to JobSync, marked as Applied:"), "Job title", title, "Company", company, save, back),
    );
  }
}
