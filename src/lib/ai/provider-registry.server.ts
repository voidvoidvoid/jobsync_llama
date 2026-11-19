import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { createOllama } from "ollama-ai-provider-v2";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APP_CONSTANTS } from "@/lib/constants";
import { normalizeOpenAICompatibleBaseUrl } from "@/lib/ai/provider-registry";
import { resolveApiKey } from "@/lib/api-key-resolver";
import { jsearchRequest, type JSearchKey } from "@/lib/scraper/remote/jsearch";

// One real search (one request from the key's plan): JSearch has no free
// "who am I" call. A spent monthly allowance still proves the key is real.
async function verifyJSearchKey(
  credential: JSearchKey,
): Promise<{ success: boolean; error?: string }> {
  const result = await jsearchRequest(credential, {
    query: "software engineer",
    pages: 1,
    remoteOnly: true,
    datePosted: "week",
  });
  if (result.success) return { success: true };
  if (result.error.type === "rate_limited") return { success: true };
  if (result.error.type === "blocked") {
    return { success: false, error: "Invalid API key, or no active JSearch subscription for it" };
  }
  if (result.error.type === "network" && /fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/.test(result.error.message)) {
    // Let the route report it as "unreachable" rather than a bad key
    throw new TypeError(result.error.message);
  }
  return {
    success: false,
    error: result.error.type === "parse" || result.error.type === "network"
      ? result.error.message
      : "Could not verify the key",
  };
}

export interface VerifyContext {
  userId?: string;
}

// GET {base}/v1/models, with the bearer key when there is one
export async function fetchOpenAICompatibleModels(
  baseUrl: string,
  apiKey: string | undefined,
): Promise<Response> {
  return fetch(`${normalizeOpenAICompatibleBaseUrl(baseUrl)}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(APP_CONSTANTS.AI_OLLAMA_LIST_TIMEOUT_MS),
  });
}

export const PROVIDER_FACTORIES: Record<
  string,
  (credential: string, modelName: string, apiKey?: string) => any
> = {
  // Chat completions, not the Responses API createOpenAI defaults to: that is
  // the one every OpenAI-compatible server implements. json_schema response
  // formats are what llama-server turns into a grammar for structured output.
  llamacpp: (baseURL, model, apiKey) =>
    createOpenAICompatible({
      name: "llamacpp",
      baseURL: normalizeOpenAICompatibleBaseUrl(baseURL),
      apiKey: apiKey || undefined,
      includeUsage: true,
      supportsStructuredOutputs: true,
    })(model),
  openai: (apiKey, model) => createOpenAI({ apiKey })(model),
  openrouter: (apiKey, model) =>
    createOpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" })(model),
  deepseek: (apiKey, model) => createDeepSeek({ apiKey })(model),
  ollama: (baseURL, model) =>
    createOllama({ baseURL: baseURL + "/api" })(model),
  gemini: (apiKey, model) => createGoogleGenerativeAI({ apiKey })(model),
};

export const PROVIDER_VERIFIERS: Record<
  string,
  (
    key: string,
    ctx?: VerifyContext,
  ) => Promise<{ success: boolean; error?: string }>
> = {
  llamacpp: async (key, ctx) => {
    const baseUrl = normalizeOpenAICompatibleBaseUrl(key);
    try {
      const apiKey = await resolveApiKey(ctx?.userId, "llamacpp-key");
      const res = await fetchOpenAICompatibleModels(key, apiKey);
      // The server answered, so the URL is right; the key is saved separately
      if (res.status === 401 || res.status === 403) return { success: true };
      if (!res.ok)
        return {
          success: false,
          error: `${baseUrl}/models returned ${res.status}. Is this an OpenAI-compatible server?`,
        };
      return { success: true };
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        return {
          success: false,
          error: `The server at ${baseUrl} did not respond in time. Please make sure it is running.`,
        };
      }
      if (
        error instanceof TypeError &&
        /failed to parse url|invalid url/i.test(error.message)
      ) {
        return { success: false, error: `Invalid URL: ${baseUrl}` };
      }
      return {
        success: false,
        error: `Cannot connect to ${baseUrl}. Please make sure the server is running and reachable from JobSync.`,
      };
    }
  },

  jsearch: (key) => verifyJSearchKey({ key, via: "direct" }),
  "jsearch-rapidapi": (key) => verifyJSearchKey({ key, via: "rapidapi" }),

  // Checked against the saved base URL. Servers that leave /models open
  // (llama-server does) accept any key here; a wrong one then fails on use.
  "llamacpp-key": async (key, ctx) => {
    const baseUrl = await resolveApiKey(ctx?.userId, "llamacpp");
    if (!baseUrl)
      return { success: false, error: "Save the llama.cpp base URL first" };
    try {
      const res = await fetchOpenAICompatibleModels(baseUrl, key);
      if (res.status === 401 || res.status === 403)
        return { success: false, error: "Invalid API key" };
      if (!res.ok)
        return {
          success: false,
          error: `${normalizeOpenAICompatibleBaseUrl(baseUrl)}/models returned ${res.status}`,
        };
      return { success: true };
    } catch {
      return {
        success: false,
        error: `Cannot connect to ${normalizeOpenAICompatibleBaseUrl(baseUrl)} to check the key. Please make sure the server is running.`,
      };
    }
  },

  openai: async (key) => {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(APP_CONSTANTS.AI_VERIFY_TIMEOUT_MS),
    });
    if (!res.ok)
      return {
        success: false,
        error:
          res.status === 401
            ? "Invalid API key"
            : `OpenAI returned ${res.status}`,
      };
    return { success: true };
  },

  // /api/v1/key is the authenticated endpoint. /models is public and answers
  // 200 to any key, so verifying against it passes anything pasted in.
  openrouter: async (key) => {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(APP_CONSTANTS.AI_VERIFY_TIMEOUT_MS),
    });
    if (!res.ok)
      return {
        success: false,
        error:
          res.status === 401
            ? "Invalid API key"
            : `OpenRouter returned ${res.status}`,
      };
    return { success: true };
  },

  deepseek: async (key) => {
    const res = await fetch("https://api.deepseek.com/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(APP_CONSTANTS.AI_VERIFY_TIMEOUT_MS),
    });
    if (!res.ok)
      return {
        success: false,
        error:
          res.status === 401
            ? "Invalid API key"
            : `DeepSeek returned ${res.status}`,
      };
    return { success: true };
  },

  ollama: async (key) => {
    const baseUrl = key.replace(/\/+$/, "");
    try {
      const res = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(APP_CONSTANTS.AI_OLLAMA_LIST_TIMEOUT_MS),
      });
      if (!res.ok)
        return {
          success: false,
          error: `Cannot connect to Ollama at ${baseUrl}`,
        };
      return { success: true };
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        return {
          success: false,
          error: `Ollama at ${baseUrl} did not respond in time. Please make sure Ollama is running.`,
        };
      }
      if (
        error instanceof TypeError &&
        /failed to parse url/i.test(error.message)
      ) {
        return {
          success: false,
          error: `Invalid Ollama URL: ${baseUrl}`,
        };
      }
      return {
        success: false,
        error: `Cannot connect to Ollama at ${baseUrl}. Please make sure Ollama is running.`,
      };
    }
  },

  gemini: async (key) => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
      { signal: AbortSignal.timeout(APP_CONSTANTS.AI_VERIFY_TIMEOUT_MS) },
    );
    if (!res.ok)
      return {
        success: false,
        error:
          res.status === 400 || res.status === 403
            ? "Invalid API key"
            : `Gemini returned ${res.status}`,
      };
    return { success: true };
  },
};
