import { JobResponse } from "@/models/job.model";
import { AiProvider } from "@/models/ai.model";
import { APP_CONSTANTS } from "@/lib/constants";

// Re-export for backwards compatibility
export { convertResumeToText } from "@/lib/ai/tools/preprocessing";
export { convertJobToText } from "@/lib/ai/tools/preprocessing-job";

export interface OllamaConnectionResult {
  isConnected: boolean;
  error?: string;
}

// llama.cpp (or another OpenAI-compatible server): reachable when its model
// list loads. The route's own message is kept, since it tells a server that is
// down apart from one that rejected the API key.
async function checkLlamacppConnection(): Promise<OllamaConnectionResult> {
  try {
    const response = await fetch("/api/ai/llamacpp/models", {
      signal: AbortSignal.timeout(
        // The route itself waits this long for the server before answering
        APP_CONSTANTS.AI_OLLAMA_LIST_TIMEOUT_MS + 2_000,
      ),
    });
    if (response.ok) return { isConnected: true };
    const data = await response.json().catch(() => null);
    return {
      isConnected: false,
      error:
        (typeof data?.error === "string" && data.error) ||
        "The llama.cpp server is not responding. Please make sure it is running.",
    };
  } catch (error) {
    console.warn("llama.cpp connection check failed:", error);
    return {
      isConnected: false,
      error:
        "Cannot connect to the llama.cpp server. Please make sure it is running.",
    };
  }
}

// Checks if a local AI service (Ollama, llama.cpp) is reachable. Hosted
// providers are always reported as connected. The name predates llama.cpp.
export const checkOllamaConnection = async (
  provider: AiProvider,
): Promise<OllamaConnectionResult> => {
  if (provider === AiProvider.LLAMACPP) {
    return checkLlamacppConnection();
  }
  if (provider !== AiProvider.OLLAMA) {
    return { isConnected: true };
  }

  try {
    const response = await fetch("/api/ai/ollama/tags", {
      signal: AbortSignal.timeout(APP_CONSTANTS.AI_OLLAMA_LIST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        isConnected: false,
        error:
          "Ollama service is not responding. Please make sure Ollama is running.",
      };
    }

    return { isConnected: true };
  } catch (error) {
    console.warn("Ollama connection check failed:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return {
      isConnected: false,
      error: `Cannot connect to Ollama service. Please make sure Ollama is running. Error: ${errorMessage}`,
    };
  }
};
