import { resolveApiKey } from "@/lib/api-key-resolver";
import { PROVIDER_REGISTRY } from "@/lib/ai/provider-registry";
import { PROVIDER_FACTORIES } from "@/lib/ai/provider-registry.server";
import { MissingCredentialError } from "@/lib/ai/tools/errors";

export type ProviderType = "openai" | "ollama" | "llamacpp" | "deepseek" | "openrouter" | "gemini";

export async function getModel(
  provider: ProviderType,
  modelName: string,
  userId?: string,
) {
  const entry = PROVIDER_REGISTRY[provider];
  if (!entry) throw new Error(`Unknown AI provider: ${provider}`);

  const factory = PROVIDER_FACTORIES[provider];
  if (!factory) throw new Error(`No factory for provider: ${provider}`);

  const credential = await resolveApiKey(userId, provider);
  if (!credential)
    throw new MissingCredentialError(entry.displayName);

  // An optional second credential (llama.cpp's API key beside its base URL)
  if (entry.apiKeyProvider) {
    const apiKey = await resolveApiKey(userId, entry.apiKeyProvider);
    return factory(credential, modelName, apiKey);
  }

  return factory(credential, modelName);
}
