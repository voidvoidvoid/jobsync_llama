import { ext } from "./webext";
import { api, loadSettings, normalizeBaseUrl, saveSettings } from "./shared/settings";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $("status");

function show(text: string, ok: boolean) {
  status.textContent = text;
  status.className = ok ? "ok" : "bad";
}

// Firefox may hold back the host permission the manifest asks for; the
// extension needs it to reach JobSync and to read forms in embedded frames.
async function hasAccess(): Promise<boolean> {
  return ext.permissions.contains({ origins: ["<all_urls>"] });
}

async function test() {
  const settings = await loadSettings();
  if (!(await hasAccess())) {
    show("Site access is not granted yet. Click \"Grant site access\".", false);
    return;
  }
  try {
    const r = await api<{ user: string; provider: string; model: string }>(settings, "/api/extension/status");
    show(`Connected to JobSync as ${r.user || "you"}. AI: ${r.provider}${r.model ? ` / ${r.model}` : ""}.`, true);
  } catch (error) {
    show(error instanceof Error ? error.message : String(error), false);
  }
}

async function init() {
  const s = await loadSettings();
  $<HTMLInputElement>("baseUrl").value = s.baseUrl;
  $<HTMLInputElement>("token").value = s.token;
  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const baseUrl = normalizeBaseUrl($<HTMLInputElement>("baseUrl").value);
    $<HTMLInputElement>("baseUrl").value = baseUrl;
    await saveSettings({ baseUrl, token: $<HTMLInputElement>("token").value });
    await test();
  });
  $("grant").addEventListener("click", async () => {
    // Must run straight from the click to count as a user action
    const granted = await ext.permissions.request({ origins: ["<all_urls>"] });
    show(granted ? "Site access granted." : "Site access was not granted.", granted);
  });
  if (s.baseUrl && s.token) await test();
}

void init();
