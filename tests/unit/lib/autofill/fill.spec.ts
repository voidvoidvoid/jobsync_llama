import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/autofill/jobLookup", () => ({ findJobForUrls: vi.fn() }));
vi.mock("@/lib/autofill/context", () => ({ loadAutofillContext: vi.fn() }));
vi.mock("@/lib/ai", () => ({ getModel: vi.fn() }));
vi.mock("@/lib/aiUsage/tracker", () => ({ startAiCall: vi.fn() }));
vi.mock("@/lib/scraper/automation-run/aiSettings", () => ({
  getUserAiSettings: vi.fn(),
  getDefaultModelForProvider: vi.fn(),
}));

import { findJobForUrls } from "@/lib/autofill/jobLookup";
import { loadAutofillContext, type AutofillContext } from "@/lib/autofill/context";
import { NOTES, runAutofill } from "@/lib/autofill/fill";
import type { AutofillField } from "@/lib/autofill/types";

const ctx: AutofillContext = {
  profile: {
    firstName: "Tom",
    lastName: "Example",
    fullName: "Tom Example",
    email: "tom@example.com",
    phone: "555-0100",
    linkedin: "https://linkedin.com/in/tom",
  },
  resume: { id: "r1", title: "Main", hasFile: true, fileName: "tom.pdf", text: "Engineer at Acme since 2020." },
  answers: [
    { id: "a1", question: "Will you require visa sponsorship?", answer: "No", updatedAt: "2026-01-01T00:00:00.000Z" },
  ],
};

const fields: AutofillField[] = [
  { id: "0:f1", label: "First Name", type: "text" },
  { id: "0:f2", label: "Email", type: "email" },
  { id: "0:f3", label: "Resume/CV", type: "file" },
  { id: "0:f4", label: "Cover letter", type: "file" },
  { id: "0:f5", label: "Do you require sponsorship?", type: "radio", options: ["Yes", "No"] },
  { id: "0:f6", label: "Gender", type: "select", options: ["Male", "Female", "Decline"] },
  { id: "0:f7", label: "Current company", type: "text" },
  { id: "0:f8", label: "Country", type: "select", options: ["Canada", "Germany"] },
  { id: "0:f9", label: "Why Acme?", type: "textarea" },
  { id: "1:f1", label: "Favourite colour", type: "text" },
];

describe("runAutofill", () => {
  beforeEach(() => {
    vi.mocked(findJobForUrls).mockResolvedValue({
      id: "j1",
      title: "Dev",
      company: "Acme",
      status: "new",
      description: "<p>Build <b>things</b></p>",
      resumeId: "r1",
    });
    vi.mocked(loadAutofillContext).mockResolvedValue(ctx);
  });

  it("fills contact details and saved answers itself and asks the AI only for the rest", async () => {
    const generate = vi.fn(async () =>
      JSON.stringify({
        answers: [
          { id: "0:f7", value: "Acme", confidence: "high" },
          { id: "0:f8", value: "france", confidence: "high" },
          { id: "0:f9", value: "x".repeat(200), confidence: "high" },
          { id: "1:f1", value: "", confidence: "low" },
        ],
      }),
    );
    const res = await runAutofill("u1", { url: "https://x.test/jobs/1", fields }, generate);
    const by = new Map(res.values.map((v) => [v.id, v]));

    expect(by.get("0:f1")).toMatchObject({ value: "Tom", source: "profile" });
    expect(by.get("0:f2")).toMatchObject({ value: "tom@example.com", source: "profile" });
    expect(by.get("0:f3")).toMatchObject({ value: "tom.pdf", source: "resume" });
    expect(by.get("0:f4")).toMatchObject({ source: "none", note: NOTES.coverFile });
    expect(by.get("0:f5")).toMatchObject({ value: "No", source: "answer", topic: "sponsorship" });
    expect(by.get("0:f6")).toMatchObject({ value: "", source: "none", note: NOTES.sensitive });
    expect(by.get("0:f7")).toMatchObject({ value: "Acme", source: "ai", confidence: "high" });
    // Not one of the options, so not filled
    expect(by.get("0:f8")).toMatchObject({ source: "none" });
    expect(by.get("0:f9")).toMatchObject({ source: "ai", confidence: "medium", note: NOTES.draft });
    expect(by.get("1:f1")).toMatchObject({ source: "none", note: NOTES.noAnswer });

    expect(generate).toHaveBeenCalledTimes(1);
    const { prompt } = (generate.mock.calls[0] as unknown as [{ prompt: string }])[0];
    expect(prompt).toContain("Current company");
    expect(prompt).not.toContain("Gender");
    expect(prompt).not.toContain("sponsorship?\",\"type");
    expect(prompt).toContain("Build things");
    expect(res.job).toEqual({ id: "j1", title: "Dev", company: "Acme", status: "new" });
    expect(res.resume).toMatchObject({ id: "r1", hasFile: true });
    expect(loadAutofillContext).toHaveBeenCalledWith("u1", "r1");
  });

  it("uses the page text when the job is not in JobSync", async () => {
    vi.mocked(findJobForUrls).mockResolvedValue(null);
    const generate = vi.fn(async () => "{}");
    const res = await runAutofill(
      "u1",
      { url: "https://x.test", pageText: "We build rockets", fields: [fields[6]] },
      generate,
    );
    expect((generate.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt).toContain("We build rockets");
    expect(res.job).toBeNull();
    expect(res.warnings).toContain("The AI reply could not be read; some fields were left empty.");
  });

  it("reports an AI failure and leaves those fields for the user", async () => {
    const generate = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const res = await runAutofill("u1", { url: "https://x.test", fields: [fields[0], fields[6]] }, generate);
    expect(res.values[0]).toMatchObject({ source: "profile" });
    expect(res.values[1]).toMatchObject({ source: "none", note: NOTES.aiFailed });
    expect(res.warnings[0]).toMatch(/connection refused/);
  });

  it("skips the AI when nothing needs it", async () => {
    const generate = vi.fn();
    await runAutofill("u1", { url: "https://x.test", fields: [fields[0], fields[5]] }, generate);
    expect(generate).not.toHaveBeenCalled();
  });
});
