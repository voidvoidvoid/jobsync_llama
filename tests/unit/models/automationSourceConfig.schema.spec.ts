import { CreateAutomationSchema, UpdateAutomationSchema } from "@/models/automation.schema";

const base = {
  name: "Test",
  resumeId: "550e8400-e29b-41d4-a716-446655440000",
  matchThreshold: 80,
  scheduleHour: 8,
};

describe("CreateAutomationSchema conditional validation", () => {
  it("rejects a retired job board", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "jsearch",
      keywords: "frontend",
      location: "Canada",
    });
    expect(result.success).toBe(false);
  });

  it("greenhouse requires at least one company", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "greenhouse",
      sourceConfig: { greenhouse: { companies: [] } },
    });
    expect(result.success).toBe(false);
  });

  it("greenhouse passes with one company and no keywords/location", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "greenhouse",
      sourceConfig: {
        greenhouse: {
          companies: [{ name: "Anthropic", token: "anthropic" }],
          targetTitles: ["Frontend Engineer"],
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("greenhouse accepts topK within 1-50 and a saveUnanalyzed boolean", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "greenhouse",
      sourceConfig: {
        greenhouse: {
          companies: [{ name: "Anthropic", token: "anthropic" }],
          topK: 25,
          saveUnanalyzed: false,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("greenhouse rejects topK of 0", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "greenhouse",
      sourceConfig: {
        greenhouse: {
          companies: [{ name: "Anthropic", token: "anthropic" }],
          topK: 0,
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("greenhouse rejects topK of 51", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "greenhouse",
      sourceConfig: {
        greenhouse: {
          companies: [{ name: "Anthropic", token: "anthropic" }],
          topK: 51,
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("ashby requires at least one company", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "ashby",
      sourceConfig: { ashby: { companies: [] } },
    });
    expect(result.success).toBe(false);
  });

  it("ashby passes with one company", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "ashby",
      sourceConfig: {
        ashby: { companies: [{ name: "Ramp", token: "ramp" }] },
      },
    });
    expect(result.success).toBe(true);
  });

  it("remote requires at least one job board", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "remote",
      sourceConfig: { remote: { companies: [] } },
    });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0].message).toBe(
      "Select at least one job board",
    );
  });

  it("remote passes with a known feed and no company list", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "remote",
      sourceConfig: {
        remote: {
          companies: [{ name: "Himalayas", token: "himalayas" }],
          keywords: ["Kubernetes"],
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("remote accepts all six job boards at once", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "remote",
      sourceConfig: {
        remote: {
          companies: [
            "himalayas",
            "jobicy",
            "remoteok",
            "weworkremotely",
            "workingnomads",
            "arbeitnow",
          ].map((token) => ({ name: token, token })),
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("remote accepts JSearch with its settings", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "remote",
      sourceConfig: {
        remote: {
          companies: [{ name: "JSearch", token: "jsearch" }],
          keywords: ["Kubernetes"],
          jsearch: { remoteOnly: true, pagesPerTerm: 5, datePosted: "3days" },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("remote caps JSearch at ten pages a term", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "remote",
      sourceConfig: {
        remote: {
          companies: [{ name: "JSearch", token: "jsearch" }],
          jsearch: { pagesPerTerm: 50 },
        },
      },
    });
    expect(result.success).toBe(false);
  });

  describe("ai-match", () => {
    const config = {
      maxJobs: 25,
      newestFirst: true,
      includeDiscovered: true,
      includeTracked: false,
      resumeSource: "job",
    };

    it("needs no companies or job boards", () => {
      const result = CreateAutomationSchema.safeParse({
        ...base,
        jobBoard: "ai-match",
        sourceConfig: { "ai-match": config },
      });
      expect(result.success).toBe(true);
    });

    it("needs at least one kind of job to score", () => {
      const result = CreateAutomationSchema.safeParse({
        ...base,
        jobBoard: "ai-match",
        sourceConfig: {
          "ai-match": { ...config, includeDiscovered: false, includeTracked: false },
        },
      });
      expect(result.success).toBe(false);
      expect(!result.success && result.error.issues[0].message).toBe(
        "Choose at least one kind of job to score",
      );
    });

    it("needs its settings", () => {
      const result = CreateAutomationSchema.safeParse({ ...base, jobBoard: "ai-match" });
      expect(result.success).toBe(false);
    });

    it.each([0, 201, 2.5])("rejects %s jobs per run", (maxJobs) => {
      const result = CreateAutomationSchema.safeParse({
        ...base,
        jobBoard: "ai-match",
        sourceConfig: { "ai-match": { ...config, maxJobs } },
      });
      expect(result.success).toBe(false);
    });

    it("lets an update switch a search automation to AI Matching", () => {
      const result = UpdateAutomationSchema.safeParse({
        jobBoard: "ai-match",
        sourceConfig: { "ai-match": config },
      });
      expect(result.success).toBe(true);
    });
  });

  it("remote rejects a feed it does not know", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "remote",
      sourceConfig: {
        remote: { companies: [{ name: "Evil", token: "evil.example.com" }] },
      },
    });
    expect(result.success).toBe(false);
  });
});
