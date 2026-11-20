// AI Matching automations: which saved jobs a run picks, in what order, with
// which resume, and what it writes back and reports.
import { PrismaClient } from "@/generated/prisma/client";

const prisma = new PrismaClient({} as never);

vi.mock("@/generated/prisma/client", () => {
  const m = {
    automationRun: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    automation: { findUnique: vi.fn(), update: vi.fn() },
    resume: { findUnique: vi.fn(), findFirst: vi.fn() },
    userSettings: { findUnique: vi.fn() },
    job: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    aiCall: { create: vi.fn().mockResolvedValue({ id: "c" }), update: vi.fn() },
  };
  return { PrismaClient: vi.fn(function () { return m; }) };
});

vi.mock("@/lib/api-key-resolver", () => ({
  resolveApiKey: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ai/provider-registry.server", () => ({
  PROVIDER_VERIFIERS: { ollama: vi.fn().mockResolvedValue({ success: true }) },
}));
vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/notifications/record", () => ({
  recordRunNotifications: vi.fn(),
}));
vi.mock("@/lib/jobs/dealBreakers", async (orig) => ({
  ...(await (orig() as Promise<Record<string, unknown>>)),
  withdrawForDealBreakers: vi.fn(async () => true),
}));
vi.mock("@/lib/aiUsage/tracker", () => ({
  startAiCall: () => ({ finish: vi.fn() }),
}));
vi.mock("@/lib/ai", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    getModel: vi.fn().mockResolvedValue({}),
    // Inputs are taken as they are; the preprocessors have their own tests
    preprocessResume: vi.fn(async (r: { id: string }) => ({
      success: true,
      data: { normalizedText: `RESUME ${r.id}` },
    })),
    preprocessJob: vi.fn(async (j: { description: string }) =>
      j.description === "short"
        ? { success: false, error: { code: "TOO_SHORT" } }
        : { success: true, data: { normalizedText: `JOB ${j.description}` } },
    ),
  };
});

import { runAutomation } from "@/lib/scraper/runner";
import { generateText } from "ai";
import { recordRunNotifications } from "@/lib/notifications/record";
import { withdrawForDealBreakers } from "@/lib/jobs/dealBreakers";
import { unmatchedJobsWhere, CLOSED_STATUSES } from "@/lib/jobs/unmatched";
import type { Automation } from "@/models/automation.model";

const reply = (score: number) => ({
  text: `SCORES: match=${score} recommendation=good\\n\\nSolid fit.`,
  usage: {},
  finishReason: "stop",
});

const automation = (config: object = {}): Automation => ({
  id: "auto-match",
  userId: "user1",
  name: "Score my backlog",
  jobBoard: "ai-match",
  keywords: "",
  location: "",
  sourceConfig: JSON.stringify({
    "ai-match": {
      maxJobs: 2,
      newestFirst: true,
      includeDiscovered: true,
      includeTracked: true,
      resumeSource: "job",
      ...config,
    },
  }),
  resumeId: "resume-main",
  matchThreshold: 75,
  scheduleHour: 9,
  nextRunAt: null,
  lastRunAt: null,
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
});

const job = (id: string, extra: object = {}) => ({
  id,
  description: `posting ${id}`,
  workplaceType: "REMOTE",
  createdAt: new Date("2026-11-10"),
  automationId: null,
  resumeId: null,
  matchData: null,
  JobTitle: { label: `Engineer ${id}` },
  Company: { label: "Acme" },
  Location: null,
  automation: null,
  ...extra,
});

const finalized = () => (prisma.automationRun.update as any).mock.calls.at(-1)[0].data;

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.automationRun.create as any).mockResolvedValue({ id: "run1" });
  (prisma.automationRun.update as any).mockResolvedValue({ id: "run1", automationId: "auto-match" });
  (prisma.automationRun.findUnique as any).mockResolvedValue({ status: "running" });
  (prisma.automation.findUnique as any).mockResolvedValue({ scheduleHour: 9 });
  (prisma.automation.update as any).mockResolvedValue({});
  (prisma.userSettings.findUnique as any).mockResolvedValue(null);
  (prisma.resume.findUnique as any).mockResolvedValue({ id: "resume-main", title: "Main" });
  (prisma.resume.findFirst as any).mockImplementation(async ({ where }: any) =>
    where.id === "resume-gone" ? null : { id: where.id, title: `Resume ${where.id}` },
  );
  (prisma.job.updateMany as any).mockResolvedValue({ count: 1 });
  (generateText as any).mockResolvedValue(reply(80));
});

describe("unmatchedJobsWhere", () => {
  it("covers both kinds, never closed jobs", () => {
    const where = unmatchedJobsWhere("user1", { includeDiscovered: true, includeTracked: true });
    expect(where.userId).toBe("user1");
    expect(where.Status).toEqual({ value: { notIn: CLOSED_STATUSES } });
    expect(where.OR).toHaveLength(2);
    expect(CLOSED_STATUSES).toEqual(
      expect.arrayContaining(["rejected", "archived", "withdrawn", "expired"]),
    );
  });

  it("finds unanalyzed listings by their marker and leaves dismissed ones", () => {
    const where = unmatchedJobsWhere("user1", { includeDiscovered: true, includeTracked: false });
    expect(where.OR).toEqual([
      {
        matchData: { contains: '"analyzed":false' },
        OR: [{ discoveryStatus: null }, { discoveryStatus: { not: "dismissed" } }],
      },
    ]);
  });

  it("finds hand-added jobs with no score", () => {
    const where = unmatchedJobsWhere("user1", { includeDiscovered: false, includeTracked: true });
    expect(where.OR).toEqual([{ automationId: null, matchScore: null }]);
  });
});

describe("runAutomation (ai-match)", () => {
  it("scores up to the limit, newest first, and saves each score", async () => {
    (prisma.job.count as any).mockResolvedValue(5);
    (prisma.job.findMany as any).mockResolvedValue([job("a"), job("b"), job("c")]);
    (generateText as any)
      .mockResolvedValueOnce(reply(90))
      .mockResolvedValueOnce(reply(40));

    const result = await runAutomation(automation());

    const query = (prisma.job.findMany as any).mock.calls[0][0];
    expect(query.orderBy[0]).toEqual({ createdAt: "desc" });
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(prisma.job.updateMany).toHaveBeenCalledTimes(2);

    const write = (prisma.job.updateMany as any).mock.calls[0][0];
    expect(write.where.id).toBe("a");
    expect(write.data.matchScore).toBe(90);
    expect(JSON.parse(write.data.matchData)).toMatchObject({
      matchScore: 90,
      analyzed: true,
      resumeId: "resume-main",
      surface: "ai-match-automation",
    });

    expect(result.status).toBe("completed");
    expect(finalized()).toMatchObject({
      jobsSearched: 5, // unmatched found
      jobsDeduplicated: 2, // selected
      jobsProcessed: 2, // scored
      jobsMatched: 1, // at or above 75%
      jobsSaved: 0,
    });
  });

  it("works oldest first when asked", async () => {
    (prisma.job.count as any).mockResolvedValue(1);
    (prisma.job.findMany as any).mockResolvedValue([job("a")]);

    await runAutomation(automation({ newestFirst: false }));

    expect((prisma.job.findMany as any).mock.calls[0][0].orderBy[0]).toEqual({
      createdAt: "asc",
    });
  });

  it("skips postings too thin to score without spending a place on them", async () => {
    (prisma.job.count as any).mockResolvedValue(3);
    (prisma.job.findMany as any).mockResolvedValue([
      job("a", { description: "short" }),
      job("b"),
      job("c"),
    ]);

    await runAutomation(automation());

    const scoredIds = (prisma.job.updateMany as any).mock.calls.map((c: any) => c[0].where.id);
    expect(scoredIds).toEqual(["b", "c"]);
  });

  it("uses each job's own resume, falling back to the automation's", async () => {
    (prisma.job.count as any).mockResolvedValue(2);
    (prisma.job.findMany as any).mockResolvedValue([
      job("found", { automationId: "search-auto", automation: { resumeId: "resume-search" }, matchData: '{"analyzed":false,"prerankScore":3}' }),
      job("gone", { resumeId: "resume-gone" }),
    ]);

    await runAutomation(automation());

    const prompts = (generateText as any).mock.calls.map((c: any) => c[0].prompt);
    expect(prompts[0]).toContain("RESUME resume-search");
    expect(prompts[1]).toContain("RESUME resume-main");
    // The listing's keyword pre-rank is kept beside its new score
    const first = JSON.parse((prisma.job.updateMany as any).mock.calls[0][0].data.matchData);
    expect(first).toMatchObject({ prerankScore: 3, analyzed: true, resumeId: "resume-search" });
  });

  it("can use the automation's resume for every job", async () => {
    (prisma.job.count as any).mockResolvedValue(1);
    (prisma.job.findMany as any).mockResolvedValue([
      job("found", { automation: { resumeId: "resume-search" } }),
    ]);

    await runAutomation(automation({ resumeSource: "automation" }));

    expect((generateText as any).mock.calls[0][0].prompt).toContain("RESUME resume-main");
  });

  it("never overwrites a job that was scored elsewhere meanwhile", async () => {
    (prisma.job.count as any).mockResolvedValue(1);
    (prisma.job.findMany as any).mockResolvedValue([job("a")]);
    (prisma.job.updateMany as any).mockResolvedValue({ count: 0 });

    await runAutomation(automation());

    const where = (prisma.job.updateMany as any).mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { matchScore: null },
      { matchData: { contains: '"analyzed":false' } },
    ]);
    expect(finalized().jobsProcessed).toBe(0);
  });

  it("finishes with errors, and counts them, when a reply has no score", async () => {
    (prisma.job.count as any).mockResolvedValue(2);
    (prisma.job.findMany as any).mockResolvedValue([job("a"), job("b")]);
    (generateText as any)
      .mockResolvedValueOnce(reply(80))
      .mockResolvedValueOnce({ text: "I cannot help", usage: {}, finishReason: "stop" });

    const result = await runAutomation(automation());

    expect(result.status).toBe("completed_with_errors");
    expect(finalized().errorMessage).toBe("1 job(s) could not be scored");
    expect((recordRunNotifications as any).mock.calls[0][1].aiMatchFailed).toBe(1);
  });

  it("stops and fails when the AI is unreachable before anything is scored", async () => {
    (prisma.job.count as any).mockResolvedValue(2);
    (prisma.job.findMany as any).mockResolvedValue([job("a"), job("b")]);
    (generateText as any).mockRejectedValue(new Error("fetch failed"));

    const result = await runAutomation(automation());

    expect(result.status).toBe("failed");
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(prisma.job.updateMany).not.toHaveBeenCalled();
  });

  it("completes with nothing to do when every job has a score", async () => {
    (prisma.job.count as any).mockResolvedValue(0);

    const result = await runAutomation(automation());

    expect(result.status).toBe("completed");
    expect(prisma.job.findMany).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("checks deal breakers, records them and withdraws the job", async () => {
    (prisma.userSettings.findUnique as any).mockResolvedValue({
      settings: JSON.stringify({
        dealBreakers: { items: ["occasional travel", "relocation"], withdraw: true },
      }),
    });
    (prisma.job.count as any).mockResolvedValue(1);
    (prisma.job.findMany as any).mockResolvedValue([job("a")]);
    (generateText as any).mockResolvedValue({
      text: "SCORES: match=88 recommendation=strong\nDEAL_BREAKERS: 1\n\n## Summary\nGood.",
      usage: {},
      finishReason: "stop",
    });

    await runAutomation(automation());

    const call = (generateText as any).mock.calls[0][0];
    expect(call.instructions).toContain('1. "occasional travel"');
    const write = (prisma.job.updateMany as any).mock.calls[0][0];
    const data = JSON.parse(write.data.matchData);
    expect(data.dealBreakers).toEqual({
      checked: ["occasional travel", "relocation"],
      found: ["occasional travel"],
    });
    expect(data.body).toBe("## Summary\nGood.");
    expect(withdrawForDealBreakers).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "a", userId: "user1" }),
    );
    // A deal-broken job is not counted as a strong match
    expect(finalized()).toMatchObject({ jobsProcessed: 1, jobsMatched: 0 });
  });
});
