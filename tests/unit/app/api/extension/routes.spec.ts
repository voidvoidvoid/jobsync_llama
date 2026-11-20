import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mcp/auth", () => ({ resolveMcpToken: vi.fn() }));
vi.mock("@/lib/mcp/rate-limit", () => ({ checkMcpRateLimit: vi.fn(() => ({ allowed: true, remaining: 1, resetIn: 0 })) }));
vi.mock("@/lib/autofill/fill", () => ({ runAutofill: vi.fn() }));
vi.mock("@/lib/autofill/store", () => ({ saveAnswersForUser: vi.fn(async () => [{}, {}]) }));
vi.mock("@/lib/autofill/context", () => ({ getSavedAnswers: vi.fn(async () => []) }));

import { resolveMcpToken } from "@/lib/mcp/auth";
import { runAutofill } from "@/lib/autofill/fill";
import { saveAnswersForUser } from "@/lib/autofill/store";
import { POST as fill, OPTIONS } from "@/app/api/extension/fill/route";
import { POST as saveAnswers } from "@/app/api/extension/answers/route";

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/extension/fill", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer jsync_x", ...headers },
    body: JSON.stringify(body),
  });

describe("extension API", () => {
  beforeEach(() => {
    vi.mocked(resolveMcpToken).mockResolvedValue({ ok: true, userId: "u1", scopes: [], tokenName: "t" });
  });

  it("rejects a request without a valid token", async () => {
    vi.mocked(resolveMcpToken).mockResolvedValue({ ok: false, status: 401, error: "Invalid token" });
    const res = await fill(req({ url: "x", fields: [] }));
    expect(res.status).toBe(401);
    expect(runAutofill).not.toHaveBeenCalled();
  });

  it("fills for the token's user and validates the body", async () => {
    vi.mocked(runAutofill).mockResolvedValue({ job: null, resume: null, values: [], warnings: [] });
    const ok = await fill(req({ url: "https://x.test", fields: [{ id: "0:f1", label: "City", type: "text" }] }));
    expect(ok.status).toBe(200);
    expect(vi.mocked(runAutofill).mock.calls[0][0]).toBe("u1");

    const bad = await fill(req({ url: "https://x.test", fields: [{ id: "0:f1", label: "City", type: "weird" }] }));
    expect(bad.status).toBe(400);
  });

  it("answers CORS preflight only for extension origins", async () => {
    const ext = OPTIONS(new Request("http://localhost/api/extension/fill", { method: "OPTIONS", headers: { Origin: "moz-extension://abc" } }));
    expect(ext.headers.get("Access-Control-Allow-Origin")).toBe("moz-extension://abc");
    const site = OPTIONS(new Request("http://localhost/api/extension/fill", { method: "OPTIONS", headers: { Origin: "https://evil.test" } }));
    expect(site.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("saves answers for the token's user", async () => {
    const res = await saveAnswers(req({ answers: [{ question: "Notice period", answer: "2 weeks" }] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: 1, total: 2 });
    expect(saveAnswersForUser).toHaveBeenCalledWith("u1", [{ question: "Notice period", answer: "2 weeks" }]);
  });
});
