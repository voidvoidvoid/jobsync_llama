import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/api-key-resolver";
import { fetchOpenAICompatibleModels } from "@/lib/ai/provider-registry.server";
import { log } from "@/lib/telemetry";

// Lists the models of a llama.cpp server or any other OpenAI-compatible API
export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const baseUrl = (await resolveApiKey(userId, "llamacpp"))!;
    const apiKey = await resolveApiKey(userId, "llamacpp-key");
    const response = await fetchOpenAICompatibleModels(baseUrl, apiKey);

    if (!response.ok) {
      const needsKey = response.status === 401 || response.status === 403;
      return NextResponse.json(
        {
          error: needsKey
            ? "The llama.cpp server rejected the request. Add or fix its API key in API Keys settings."
            : `Failed to fetch llama.cpp models (the server returned ${response.status})`,
        },
        // Never 401: the client reads that as its own session having expired
        { status: needsKey ? 502 : response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    log.warn("llama.cpp models unreachable", {
      provider: "llamacpp",
      error: String(error),
    });
    return NextResponse.json(
      {
        error:
          "Cannot connect to the llama.cpp server. Check its base URL in API Keys settings and make sure it is running.",
      },
      { status: 502 },
    );
  }
}
