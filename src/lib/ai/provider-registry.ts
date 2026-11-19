export type CredentialType = "api-key" | "base-url";
export type ProviderCategory = "cloud" | "local";

export interface ProviderRegistryEntry {
  id: string;
  displayName: string;
  credentialType: CredentialType;
  category: ProviderCategory;
  envVar?: string;
  defaultCredential?: string;
  // Id of a second, optional credential (an API key for a base-url provider)
  apiKeyProvider?: string;
  // True for an entry that only holds another provider's optional credential:
  // listed under API Keys, never offered as an AI provider
  companionOf?: string;
  modelsEndpoint?: string;
  parseModelsResponse?: (data: any) => string[];
  requiresRunningCheck: boolean;
  supportsKeepAlive: boolean;
  keyConfig: {
    placeholder: string;
    inputType: "password" | "text";
    description: string;
    sensitive: boolean;
  };
}

export const PROVIDER_REGISTRY: Record<string, ProviderRegistryEntry> = {
  ollama: {
    id: "ollama",
    displayName: "Ollama",
    credentialType: "base-url",
    category: "local",
    envVar: "OLLAMA_BASE_URL",
    defaultCredential: "http://127.0.0.1:11434",
    modelsEndpoint: "ollama/tags",
    parseModelsResponse: (data) => data.models?.map((m: any) => m.name) ?? [],
    requiresRunningCheck: false,
    supportsKeepAlive: true,
    keyConfig: {
      placeholder: "http://127.0.0.1:11434",
      inputType: "text",
      description: "Base URL for your Ollama instance",
      sensitive: false,
    },
  },

  openai: {
    id: "openai",
    displayName: "OpenAI",
    credentialType: "api-key",
    category: "cloud",
    envVar: "OPENAI_API_KEY",
    modelsEndpoint: "openai/models",
    parseModelsResponse: (data) =>
      (data.data?.map((m: any) => m.id) ?? [])
        .filter((id: string) => id.startsWith("gpt-") || id.startsWith("o"))
        .sort(),
    requiresRunningCheck: false,
    supportsKeepAlive: false,
    keyConfig: {
      placeholder: "sk-...",
      inputType: "password",
      description: "Used for GPT models in resume review and job matching",
      sensitive: true,
    },
  },

  deepseek: {
    id: "deepseek",
    displayName: "DeepSeek",
    credentialType: "api-key",
    category: "cloud",
    envVar: "DEEPSEEK_API_KEY",
    modelsEndpoint: "deepseek/models",
    parseModelsResponse: (data) => data.data?.map((m: any) => m.id) ?? [],
    requiresRunningCheck: false,
    supportsKeepAlive: false,
    keyConfig: {
      placeholder: "sk-...",
      inputType: "password",
      description: "Used for DeepSeek models in resume review and job matching",
      sensitive: true,
    },
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    credentialType: "api-key",
    category: "cloud",
    envVar: "OPENROUTER_API_KEY",
    modelsEndpoint: "openrouter/models",
    parseModelsResponse: (data) =>
      (data.data?.map((m: any) => m.id) ?? []).sort(),
    requiresRunningCheck: false,
    supportsKeepAlive: false,
    keyConfig: {
      placeholder: "sk-or-...",
      inputType: "password",
      description: "Access 200+ models from multiple providers via OpenRouter",
      sensitive: true,
    },
  },

  gemini: {
    id: "gemini",
    displayName: "Google Gemini",
    credentialType: "api-key",
    category: "cloud",
    envVar: "GEMINI_API_KEY",
    modelsEndpoint: "gemini/models",
    parseModelsResponse: (data) =>
      data.models?.map((m: any) => m.name?.replace("models/", "")) ?? [],
    requiresRunningCheck: false,
    supportsKeepAlive: false,
    keyConfig: {
      placeholder: "AIza...",
      inputType: "password",
      description: "Used for Gemini models in resume review and job matching",
      sensitive: true,
    },
  },

  // Any server that speaks the OpenAI chat-completions API: llama.cpp's
  // llama-server, and also LM Studio, vLLM, LocalAI, text-generation-webui...
  llamacpp: {
    id: "llamacpp",
    displayName: "llama.cpp (OpenAI-compatible)",
    credentialType: "base-url",
    category: "local",
    envVar: "LLAMACPP_BASE_URL",
    defaultCredential: "http://127.0.0.1:8080",
    apiKeyProvider: "llamacpp-key",
    modelsEndpoint: "llamacpp/models",
    parseModelsResponse: (data) =>
      (data.data?.map((m: any) => m.id) ?? [])
        .filter((id: unknown): id is string => typeof id === "string" && id !== "")
        .sort(),
    requiresRunningCheck: false,
    supportsKeepAlive: false,
    keyConfig: {
      placeholder: "http://127.0.0.1:8080",
      inputType: "text",
      description:
        "Base URL of a llama.cpp server, or any other OpenAI-compatible API (LM Studio, vLLM, LocalAI). /v1 is added if missing",
      sensitive: false,
    },
  },

  "llamacpp-key": {
    id: "llamacpp-key",
    displayName: "llama.cpp API key (optional)",
    credentialType: "api-key",
    category: "local",
    envVar: "LLAMACPP_API_KEY",
    companionOf: "llamacpp",
    requiresRunningCheck: false,
    supportsKeepAlive: false,
    keyConfig: {
      placeholder: "sk-...",
      inputType: "password",
      description:
        "Only needed when the server was started with --api-key, or the OpenAI-compatible endpoint requires one",
      sensitive: true,
    },
  },
};

// Keys for job sources rather than AI providers. Listed on the API Keys page
// after the AI providers, never offered as an AI provider. JSearch is sold
// both directly and on RapidAPI, with different keys and hosts; either works,
// and a direct key is used when both are saved.
export const JOB_SOURCE_CREDENTIALS: ProviderRegistryEntry[] = [
  {
    id: "jsearch",
    displayName: "JSearch (OpenWeb Ninja)",
    credentialType: "api-key",
    category: "cloud",
    envVar: "JSEARCH_API_KEY",
    requiresRunningCheck: false,
    supportsKeepAlive: false,
    keyConfig: {
      placeholder: "Your OpenWeb Ninja API key",
      inputType: "password",
      description:
        "Job search across LinkedIn, Indeed, Glassdoor and more, for remote job board automations. Free and paid plans use the same key. Checking a key uses one request from its plan",
      sensitive: true,
    },
  },
  {
    id: "jsearch-rapidapi",
    displayName: "JSearch (RapidAPI)",
    credentialType: "api-key",
    category: "cloud",
    envVar: "JSEARCH_RAPIDAPI_KEY",
    requiresRunningCheck: false,
    supportsKeepAlive: false,
    keyConfig: {
      placeholder: "Your RapidAPI key",
      inputType: "password",
      description:
        "Only if you subscribed to JSearch through RapidAPI instead. Used when no OpenWeb Ninja key is saved. Checking a key uses one request from its plan",
      sensitive: true,
    },
  },
];

for (const entry of JOB_SOURCE_CREDENTIALS) {
  PROVIDER_REGISTRY[entry.id] = entry;
}

export const AI_PROVIDERS = ["ollama", "llamacpp", "openai", "deepseek", "openrouter", "gemini"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export function getAiProviders(): ProviderRegistryEntry[] {
  return AI_PROVIDERS.map((id) => PROVIDER_REGISTRY[id]);
}

// Everything the API Keys page stores: each AI provider, followed by its
// optional companion credential when it has one, then the job-source keys.
export function getCredentialProviders(): ProviderRegistryEntry[] {
  return [
    ...getAiProviders().flatMap((entry) =>
      entry.apiKeyProvider
        ? [entry, PROVIDER_REGISTRY[entry.apiKeyProvider]]
        : [entry],
    ),
    ...JOB_SOURCE_CREDENTIALS,
  ];
}

// Accepts http://host:8080, http://host:8080/ and http://host:8080/v1 alike
export function normalizeOpenAICompatibleBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}
