import type {
  AutofillField,
  AutofillFillResponse,
  AutofillValue,
} from "../../src/lib/autofill/types";
import { ext } from "./webext";
import {
  PORT_NAME,
  type ApplyOutcome,
  type CollectedValue,
  type PanelEvent,
  type PanelItem,
  type PanelRequest,
  type PanelState,
  type ResumeFilePayload,
  type ScanResult,
} from "./shared/protocol";
import { answersToRemember, guessJob } from "./shared/review";
import { api, ApiError, loadSettings, type ExtensionSettings } from "./shared/settings";

// Everything known about one fill of one tab; lives as long as its panel
interface Session {
  tabId: number;
  settings: ExtensionSettings;
  fields: AutofillField[];
  filled: Map<string, AutofillValue>;
  response: AutofillFillResponse | null;
  url: string;
  title: string;
  pageText: string;
  state: PanelState;
}

function splitId(id: string): [number, string] {
  const i = id.indexOf(":");
  return [Number(id.slice(0, i)), id.slice(i + 1)];
}

async function inFrames<T>(
  tabId: number,
  frameIds: number[] | "all",
   
  func: (...args: any[]) => T,
  args: unknown[] = [],
): Promise<Array<{ frameId: number; result: Awaited<T> | undefined }>> {
  const target = frameIds === "all" ? { tabId, allFrames: true } : { tabId, frameIds };
  const results = await ext.scripting.executeScript({ target, func, args });
  return (results ?? []).map((r: { frameId: number; result?: Awaited<T> }) => ({
    frameId: r.frameId,
    result: r.result,
  }));
}

function display(v: AutofillValue | undefined): string {
  if (!v) return "";
  const text = Array.isArray(v.value) ? v.value.join(", ") : v.value;
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function fetchResume(s: Session, resumeId: string): Promise<ResumeFilePayload | null> {
  try {
    const res = await fetch(`${s.settings.baseUrl}/api/extension/resume?resumeId=${encodeURIComponent(resumeId)}`, {
      headers: { Authorization: `Bearer ${s.settings.token}` },
    });
    if (!res.ok) return null;
    const disposition = res.headers.get("content-disposition") ?? "";
    const name = disposition.match(/filename="([^"]+)"/)?.[1] ?? "resume.pdf";
    return {
      name,
      type: res.headers.get("content-type") ?? "application/pdf",
      base64: bytesToBase64(await res.arrayBuffer()),
    };
  } catch {
    return null;
  }
}

async function run(s: Session, emit: (e: PanelEvent) => void) {
  const setState = (patch: Partial<PanelState>) => {
    s.state = { ...s.state, ...patch };
    emit({ type: "state", state: s.state });
  };

  // 1. Read the form in every frame (an embedded Greenhouse form is one)
  const scans = await inFrames(s.tabId, "all", () =>
    (window as Window).__jobsyncAutofill?.scan(),
  );
  const top = scans.find((r) => r.frameId === 0)?.result as ScanResult | undefined;
  s.url = top?.url ?? "";
  s.title = top?.title ?? "";
  s.pageText = top?.pageText ?? "";
  const frameUrls: string[] = [];
  const kept: string[] = [];
  for (const { frameId, result } of scans) {
    const scan = result as ScanResult | undefined;
    if (!scan || scan.fields.length === 0) continue;
    if (frameId !== 0) frameUrls.push(scan.url);
    for (const f of scan.fields) {
      const id = `${frameId}:${f.id}`;
      const { hasValue, ...field } = f;
      s.fields.push({ ...field, id });
      if (hasValue) kept.push(id);
    }
  }
  const jobGuess = guessJob(s.title, s.url);
  if (s.fields.length === 0) {
    setState({
      phase: "error",
      message: "No form fields found. If the form opens after clicking Apply, click Apply first, then try again.",
      jobGuess,
    });
    return;
  }

  // 2. Ask JobSync for the empty ones
  const keptSet = new Set(kept);
  const toFill = s.fields.filter((f) => !keptSet.has(f.id));
  setState({
    message: `Asking your AI about ${toFill.length} field${toFill.length === 1 ? "" : "s"}... a local model can take a minute.`,
    jobGuess,
  });
  if (toFill.length > 0) {
    s.response = await api<AutofillFillResponse>(s.settings, "/api/extension/fill", {
      method: "POST",
      body: JSON.stringify({ url: s.url, frameUrls, title: s.title, pageText: s.pageText, fields: toFill }),
    });
    for (const v of s.response.values) s.filled.set(v.id, v);
  }

  // 3. Fill each frame
  setState({ message: "Filling the form..." });
  const needsFile = [...s.filled.values()].some((v) => v.source === "resume");
  const file =
    needsFile && s.response?.resume?.hasFile ? await fetchResume(s, s.response.resume.id) : null;
  const byFrame = new Map<number, AutofillValue[]>();
  for (const v of s.filled.values()) {
    const [frameId, local] = splitId(v.id);
    const list = byFrame.get(frameId) ?? [];
    list.push({ ...v, id: local });
    byFrame.set(frameId, list);
  }
  const keptByFrame = new Map<number, string[]>();
  for (const id of kept) {
    const [frameId, local] = splitId(id);
    keptByFrame.set(frameId, [...(keptByFrame.get(frameId) ?? []), local]);
  }
  const errors = new Map<string, string>();
  for (const frameId of new Set([...byFrame.keys(), ...keptByFrame.keys()])) {
    const results = await inFrames(
      s.tabId,
      [frameId],
      async (values: AutofillValue[], f: ResumeFilePayload | null, keep: string[]) => {
        const api = (window as Window).__jobsyncAutofill;
        api?.markKept(keep);
        return api ? api.apply(values, f) : [];
      },
      [byFrame.get(frameId) ?? [], file, keptByFrame.get(frameId) ?? []],
    );
    for (const o of (results[0]?.result ?? []) as ApplyOutcome[]) {
      if (!o.ok) errors.set(`${frameId}:${o.id}`, o.error ?? "failed");
    }
  }

  // 4. Report
  const items: PanelItem[] = s.fields.map((f) => {
    const v = s.filled.get(f.id);
    const error = errors.get(f.id);
    if (keptSet.has(f.id)) return { id: f.id, label: f.label, display: "", source: "kept" };
    return {
      id: f.id,
      label: f.label,
      display: v?.source === "resume" && !file ? "" : display(v),
      source: error ? "none" : (v?.source ?? "none"),
      ...(v?.note ? { note: v.note } : {}),
      ...(error ? { error } : {}),
    };
  });
  const red = items.filter((i) => i.source === "none").length;
  setState({
    phase: "done",
    message: red > 0
      ? `Filled what JobSync could. ${red} field${red === 1 ? " needs" : "s need"} you (red). Review everything before you submit.`
      : "Filled. Review everything, especially AI answers (yellow), before you submit.",
    job: s.response?.job ?? null,
    items,
    warnings: s.response?.warnings ?? [],
  });
}

async function handleRequest(s: Session, msg: PanelRequest, emit: (e: PanelEvent) => void) {
  switch (msg.type) {
    case "ping":
      return;
    case "focus": {
      const [frameId, local] = splitId(msg.id);
      await inFrames(s.tabId, [frameId], (id: string) => (window as Window).__jobsyncAutofill?.focus(id), [local]);
      return;
    }
    case "close":
      await inFrames(s.tabId, "all", () => (window as Window).__jobsyncAutofill?.clear()).catch(() => {});
      return;
    case "review-answers": {
      const results = await inFrames(s.tabId, "all", () => (window as Window).__jobsyncAutofill?.collect());
      const current: CollectedValue[] = results.flatMap(({ frameId, result }) =>
        ((result ?? []) as CollectedValue[]).map((c) => ({ ...c, id: `${frameId}:${c.id}` })),
      );
      emit({ type: "answer-candidates", candidates: answersToRemember(s.fields, s.filled, current) });
      return;
    }
    case "save-answers": {
      const r = await api<{ saved: number }>(s.settings, "/api/extension/answers", {
        method: "POST",
        body: JSON.stringify({ answers: msg.answers }),
      });
      emit({ type: "notice", ok: true, message: `Saved ${r.saved} answer${r.saved === 1 ? "" : "s"} to JobSync.` });
      return;
    }
    case "mark-applied": {
      const job = s.response?.job;
      const body = job
        ? { jobId: job.id }
        : { url: s.url, jobTitle: msg.jobTitle ?? "", company: msg.company ?? "", description: s.pageText };
      const r = await api<{ ok: boolean; message: string; jobId?: string }>(s.settings, "/api/extension/applied", {
        method: "POST",
        body: JSON.stringify(body),
      });
      emit({ type: "notice", ok: r.ok, message: r.message });
      return;
    }
  }
}

ext.runtime.onConnect.addListener((port: {
  name: string;
  sender?: { tab?: { id?: number }; frameId?: number };
  postMessage(m: PanelEvent): void;
  onMessage: { addListener(cb: (m: PanelRequest) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}) => {
  if (port.name !== PORT_NAME || port.sender?.frameId !== 0) return;
  const tabId = port.sender?.tab?.id;
  if (tabId === undefined) return;
  let open = true;
  port.onDisconnect.addListener(() => {
    open = false;
  });
  const emit = (e: PanelEvent) => {
    if (open) port.postMessage(e);
  };
  const fail = (error: unknown) => {
    const message = error instanceof ApiError || error instanceof Error ? error.message : String(error);
    emit({ type: "notice", ok: false, message });
    return message;
  };

  void (async () => {
    const settings = await loadSettings();
    const s: Session = {
      tabId,
      settings,
      fields: [],
      filled: new Map(),
      response: null,
      url: "",
      title: "",
      pageText: "",
      state: { phase: "working", message: "Reading the form...", job: null, items: [], warnings: [] },
    };
    port.onMessage.addListener((msg) => {
      handleRequest(s, msg, emit).catch(fail);
    });
    try {
      await run(s, emit);
    } catch (error) {
      const message = fail(error);
      s.state = { ...s.state, phase: "error", message };
      emit({ type: "state", state: s.state });
    }
  })();
});

async function start(tab: { id?: number }) {
  if (tab.id === undefined) return;
  const settings = await loadSettings();
  if (!settings.baseUrl || !settings.token) {
    await ext.runtime.openOptionsPage();
    return;
  }
  try {
    await ext.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["content.js"] });
    await ext.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      func: () => (window as Window).__jobsyncAutofill?.start(),
    });
  } catch (error) {
    await ext.action.setBadgeText({ tabId: tab.id, text: "!" });
    await ext.action.setTitle({
      tabId: tab.id,
      title: `JobSync Autofill cannot run on this page: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

ext.action.onClicked.addListener(start);
