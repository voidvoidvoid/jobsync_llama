import { ext } from "../webext";

export interface ExtensionSettings {
  baseUrl: string;
  token: string;
}

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await ext.storage.local.get(["baseUrl", "token"]);
  return {
    baseUrl: normalizeBaseUrl(stored.baseUrl ?? ""),
    token: (stored.token ?? "").trim(),
  };
}

export async function saveSettings(s: ExtensionSettings): Promise<void> {
  await ext.storage.local.set({ baseUrl: normalizeBaseUrl(s.baseUrl), token: s.token.trim() });
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  settings: ExtensionSettings,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${settings.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${settings.token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(`Could not reach JobSync at ${settings.baseUrl}.`, 0);
  }
  if (res.status === 401) {
    throw new ApiError("JobSync rejected the access token. Create a new one under Settings → Application Autofill.", 401);
  }
  if (!res.ok) {
    let message = `JobSync answered ${res.status}.`;
    try {
      const body = await res.json();
      message = body.error || body.message || message;
    } catch {
      // not JSON
    }
    throw new ApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}
