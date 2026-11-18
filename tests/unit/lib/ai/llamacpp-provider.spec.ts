// The real @ai-sdk/openai-compatible provider against a stubbed fetch: what
// matters is the request a llama.cpp server actually receives.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-key-resolver", () => ({ resolveApiKey: vi.fn() }));

import { generateText, Output } from "ai";
import { z } from "zod";
import {
  PROVIDER_FACTORIES,
  PROVIDER_VERIFIERS,
} from "@/lib/ai/provider-registry.server";
import { resolveApiKey } from "@/lib/api-key-resolver";

function chatCompletion(content: string) {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1,
      model: "qwen3-14b",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function lastRequest(fetchMock: any) {
  const [url, init] = fetchMock.mock.calls.at(-1);
  return {
    url: String(url),
    headers: new Headers(init.headers),
    body: JSON.parse(init.body),
  };
}

describe("PROVIDER_FACTORIES – llamacpp", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts to /v1/chat/completions on the configured server", async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatCompletion("hello"));
    global.fetch = fetchMock;

    const model = PROVIDER_FACTORIES.llamacpp("http://10.0.0.5:8080", "qwen3-14b");
    const result = await generateText({ model, prompt: "hi", maxRetries: 0 });

    const sent = lastRequest(fetchMock);
    expect(sent.url).toBe("http://10.0.0.5:8080/v1/chat/completions");
    expect(sent.body.model).toBe("qwen3-14b");
    expect(sent.headers.get("authorization")).toBeNull();
    expect(result.text).toBe("hello");
    expect(result.usage.inputTokens).toBe(11);
    expect(result.usage.outputTokens).toBe(7);
  });

  it("does not double the /v1 a user typed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatCompletion("hello"));
    global.fetch = fetchMock;

    const model = PROVIDER_FACTORIES.llamacpp("http://10.0.0.5:8080/v1/", "m");
    await generateText({ model, prompt: "hi", maxRetries: 0 });

    expect(lastRequest(fetchMock).url).toBe(
      "http://10.0.0.5:8080/v1/chat/completions",
    );
  });

  it("sends the API key as a bearer token when one is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatCompletion("hello"));
    global.fetch = fetchMock;

    const model = PROVIDER_FACTORIES.llamacpp("http://10.0.0.5:8080", "m", "secret");
    await generateText({ model, prompt: "hi", maxRetries: 0 });

    expect(lastRequest(fetchMock).headers.get("authorization")).toBe(
      "Bearer secret",
    );
  });

  it("asks for a JSON schema, which llama-server enforces with a grammar", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(chatCompletion('{"score":82}'));
    global.fetch = fetchMock;

    const model = PROVIDER_FACTORIES.llamacpp("http://10.0.0.5:8080", "m");
    const result = await generateText({
      model,
      prompt: "score it",
      output: Output.object({ schema: z.object({ score: z.number() }) }),
      maxRetries: 0,
    });

    const { body } = lastRequest(fetchMock);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.schema.properties.score).toBeDefined();
    expect(result.output).toEqual({ score: 82 });
  });
});

describe("PROVIDER_VERIFIERS – llamacpp", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    (resolveApiKey as any).mockReset();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("accepts a server that lists its models", async () => {
    (resolveApiKey as any).mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;

    const result = await PROVIDER_VERIFIERS.llamacpp("http://10.0.0.5:8080", {
      userId: "user-1",
    });

    expect(result).toEqual({ success: true });
    expect(fetchMock.mock.calls[0][0]).toBe("http://10.0.0.5:8080/v1/models");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({});
  });

  it("uses the saved API key when checking the URL", async () => {
    (resolveApiKey as any).mockResolvedValue("secret");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;

    await PROVIDER_VERIFIERS.llamacpp("http://10.0.0.5:8080", { userId: "user-1" });

    expect(resolveApiKey).toHaveBeenCalledWith("user-1", "llamacpp-key");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      Authorization: "Bearer secret",
    });
  });

  // The key is saved on its own card, after the URL
  it("accepts a reachable server that wants a key", async () => {
    (resolveApiKey as any).mockResolvedValue(undefined);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });

    const result = await PROVIDER_VERIFIERS.llamacpp("http://10.0.0.5:8080");

    expect(result).toEqual({ success: true });
  });

  it("rejects a server that is not OpenAI-compatible", async () => {
    (resolveApiKey as any).mockResolvedValue(undefined);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    const result = await PROVIDER_VERIFIERS.llamacpp("http://10.0.0.5:8080");

    expect(result.success).toBe(false);
    expect(result.error).toContain("404");
  });

  it("reports an unreachable server", async () => {
    (resolveApiKey as any).mockResolvedValue(undefined);
    global.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const result = await PROVIDER_VERIFIERS.llamacpp("http://10.0.0.5:8080");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Cannot connect to http://10.0.0.5:8080/v1");
  });
});

describe("PROVIDER_VERIFIERS – llamacpp-key", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    (resolveApiKey as any).mockReset();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("checks the key against the saved base URL", async () => {
    (resolveApiKey as any).mockResolvedValue("http://10.0.0.5:8080");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;

    const result = await PROVIDER_VERIFIERS["llamacpp-key"]("secret", {
      userId: "user-1",
    });

    expect(result).toEqual({ success: true });
    expect(resolveApiKey).toHaveBeenCalledWith("user-1", "llamacpp");
    expect(fetchMock.mock.calls[0][0]).toBe("http://10.0.0.5:8080/v1/models");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      Authorization: "Bearer secret",
    });
  });

  it("rejects a key the server refuses", async () => {
    (resolveApiKey as any).mockResolvedValue("http://10.0.0.5:8080");
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });

    const result = await PROVIDER_VERIFIERS["llamacpp-key"]("wrong");

    expect(result).toEqual({ success: false, error: "Invalid API key" });
  });
});
