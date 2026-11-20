import { PrismaClient } from "@/generated/prisma/client";

const prisma = new PrismaClient({} as never);

vi.mock("@/generated/prisma/client", () => {
  const m = {
    automationRun: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    automation: { findUnique: vi.fn(), update: vi.fn() },
    resume: { findUnique: vi.fn() },
    userSettings: { findUnique: vi.fn() },
    job: { findMany: vi.fn(), create: vi.fn() },
    jobTitle: { findUnique: vi.fn(), create: vi.fn() },
    location: { findUnique: vi.fn(), create: vi.fn() },
    company: { findUnique: vi.fn(), create: vi.fn() },
    jobSource: { findUnique: vi.fn(), create: vi.fn() },
    jobStatus: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    jobStage: { create: vi.fn() },
    jobStageType: {
      findUnique: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
    },
  };
  return {
    PrismaClient: vi.fn(function () {
      return m;
    }),
  };
});

vi.mock("@/lib/scraper/greenhouse", () => ({
  searchGreenhouseJobs: vi.fn(),
}));

vi.mock("@/lib/scraper/lever", () => ({
  searchLeverJobs: vi.fn(),
}));

vi.mock("@/lib/scraper/remote", () => ({
  searchRemoteFeeds: vi.fn(),
  remoteLocationMatches: (location: string, wanted: string[]) =>
    /worldwide/i.test(location) ||
    wanted.some((w) => location.toLowerCase().includes(w.toLowerCase())),
}));

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

vi.mock("@/lib/ai", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, getModel: vi.fn().mockResolvedValue({}) };
});

import { runAutomation } from "@/lib/scraper/runner";
import { searchGreenhouseJobs } from "@/lib/scraper/greenhouse";
import { searchLeverJobs } from "@/lib/scraper/lever";
import { searchRemoteFeeds } from "@/lib/scraper/remote";
import { generateText } from "ai";
import { recordRunNotifications } from "@/lib/notifications/record";
import type { Automation } from "@/models/automation.model";

function makeJob(title: string, description = "", extra = {}) {
  return {
    title,
    company: "Acme",
    location: "Remote",
    description,
    url: `https://jobs.lever.co/acme/${Math.random()}`,
    postedDate: "2026-06-01T00:00:00Z",
    ...extra,
  };
}

const leverAutomation: Automation = {
  id: "auto-lever",
  userId: "user1",
  name: "Lever",
  jobBoard: "lever",
  keywords: "",
  location: "",
  sourceConfig: JSON.stringify({
    lever: {
      companies: [{ name: "Acme", token: "acme", host: "eu" }],
      targetTitles: ["Frontend Engineer"],
      keywords: [],
      locations: [],
      strictLocation: false,
    },
  }),
  resumeId: "resume1",
  matchThreshold: 80,
  scheduleHour: 8,
  nextRunAt: null,
  lastRunAt: null,
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("runAutomation (lever)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (prisma.automationRun.create as any).mockResolvedValue({ id: "run1" });
    (prisma.automationRun.update as any).mockResolvedValue({
      id: "run1",
      automationId: "auto-lever",
    });
    (prisma.automation.findUnique as any).mockResolvedValue({ scheduleHour: 8 });
    (prisma.automation.update as any).mockResolvedValue({});
    (prisma.userSettings.findUnique as any).mockResolvedValue(null);
    (prisma.resume.findUnique as any).mockResolvedValue({
      id: "resume1",
      title: "My Resume",
      ContactInfo: null,
      ResumeSections: [],
    });
    (prisma.job.findMany as any).mockResolvedValue([]);
    (prisma.job.create as any).mockResolvedValue({});
    (prisma.jobTitle.findUnique as any).mockResolvedValue({ id: "jt" });
    (prisma.location.findUnique as any).mockResolvedValue({ id: "loc" });
    (prisma.company.findUnique as any).mockResolvedValue({ id: "co" });
    (prisma.jobSource.findUnique as any).mockResolvedValue({ id: "src" });
    (prisma.jobStatus.findFirst as any).mockResolvedValue({ id: "st" });
    // Every saved job now gets its first current stage, which resolves the
    // status-named stage type through the same Prisma mock.
    (prisma.jobStatus.findUnique as any).mockResolvedValue({
      id: "st",
      label: "New",
    });
    (prisma.jobStageType.findUnique as any).mockResolvedValue({
      id: "stage-type-new",
      label: "New",
    });
    (prisma.jobStage.create as any).mockResolvedValue({ id: "stage-1" });

    (generateText as any).mockResolvedValue({
      text: "SCORES: match=90 recommendation=strong match\n\n## Summary\nGreat fit",
    });
  });

  it("dispatches to the Lever provider (reads the lever config key), not Greenhouse", async () => {
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "React")],
      errors: [],
    });

    const result = await runAutomation(leverAutomation);

    expect(result.status).toBe("completed");
    expect((searchLeverJobs as any).mock.calls.length).toBe(1);
    expect((searchGreenhouseJobs as any).mock.calls.length).toBe(0);
    // The lever config's companies (with host) are passed through.
    expect((searchLeverJobs as any).mock.calls[0][0]).toEqual([
      { name: "Acme", token: "acme", host: "eu" },
    ]);
    expect(result.jobsSaved).toBe(1);
  });

  describe("exclude keywords", () => {
    const withExclude = (excludeKeywords: string[]): Automation => ({
      ...leverAutomation,
      sourceConfig: JSON.stringify({
        lever: {
          companies: [{ name: "Acme", token: "acme", host: "eu" }],
          targetTitles: ["Frontend Engineer"],
          keywords: [],
          locations: [],
          strictLocation: false,
          excludeKeywords,
        },
      }),
    });

    it("never saves or analyzes an excluded listing", async () => {
      (searchLeverJobs as any).mockResolvedValue({
        jobs: [
          makeJob("Frontend Engineer", "React"),
          makeJob("Senior Frontend Engineer", "React"),
        ],
        errors: [],
      });

      const result = await runAutomation(withExclude(["senior"]));

      expect(result.jobsSaved).toBe(1);
      expect(generateText).toHaveBeenCalledTimes(1);
      const saved = (prisma.job.create as any).mock.calls.map(
        (c: any) => c[0].data.description,
      );
      expect(saved).toHaveLength(1);
      const run = (prisma.automationRun.update as any).mock.calls.at(-1)[0].data;
      expect(JSON.parse(run.funnelStats)).toContainEqual({
        key: "excluded",
        label: "Not excluded",
        count: 1,
      });
    });

    it("says when every new listing was excluded", async () => {
      (searchLeverJobs as any).mockResolvedValue({
        jobs: [makeJob("Senior Frontend Engineer", "React")],
        errors: [],
      });

      const result = await runAutomation(withExclude(["senior"]));

      expect(result.jobsSaved).toBe(0);
      expect(generateText).not.toHaveBeenCalled();
    });
  });

  describe("remote job boards", () => {
    const remoteAutomation: Automation = {
      ...leverAutomation,
      id: "auto-remote",
      jobBoard: "remote",
      sourceConfig: JSON.stringify({
        remote: {
          companies: [
            { name: "Himalayas", token: "himalayas" },
            { name: "Jobicy", token: "jobicy" },
          ],
          targetTitles: ["Frontend Engineer"],
          keywords: ["React"],
          locations: ["United States"],
          strictLocation: true,
        },
      }),
    };

    it("searches the feeds with the titles and keywords, and no company list", async () => {
      (searchRemoteFeeds as any).mockResolvedValue({
        jobs: [
          makeJob("Frontend Engineer", "React", {
            location: "Worldwide",
            source: "Himalayas",
            workplaceType: "REMOTE",
          }),
        ],
        errors: [],
      });

      const result = await runAutomation(remoteAutomation);

      expect(result.status).toBe("completed");
      expect((searchLeverJobs as any).mock.calls.length).toBe(0);
      expect((searchRemoteFeeds as any).mock.calls[0]).toEqual([
        [
          { name: "Himalayas", token: "himalayas" },
          { name: "Jobicy", token: "jobicy" },
        ],
        {
          targetTitles: ["Frontend Engineer"],
          keywords: ["React"],
          // the owner, for sources behind their own API key
          userId: remoteAutomation.userId,
          jsearch: undefined,
        },
      ]);
      expect(result.jobsSaved).toBe(1);
      expect((prisma.job.create as any).mock.calls[0][0].data.workplaceType).toBe(
        "REMOTE",
      );
    });

    it("records the feed, not the board, as the job's source", async () => {
      (prisma.jobSource.findUnique as any).mockResolvedValue(null);
      (prisma.jobSource.create as any).mockResolvedValue({ id: "src-new" });
      (searchRemoteFeeds as any).mockResolvedValue({
        jobs: [
          makeJob("Frontend Engineer", "React", {
            location: "Worldwide",
            source: "Himalayas",
          }),
        ],
        errors: [],
      });

      await runAutomation(remoteAutomation);

      const created = (prisma.jobSource.create as any).mock.calls[0][0];
      expect(created.data.label).toBe("Himalayas");
    });

    it("drops roles restricted to other places but keeps worldwide ones", async () => {
      (searchRemoteFeeds as any).mockResolvedValue({
        jobs: [
          makeJob("Frontend Engineer", "React", { location: "Worldwide" }),
          makeJob("Frontend Engineer", "React", { location: "Germany" }),
        ],
        errors: [],
      });

      const result = await runAutomation(remoteAutomation);

      expect(result.jobsSaved).toBe(1);
    });

    it("hands the automation's JSearch settings to the search", async () => {
      (searchRemoteFeeds as any).mockResolvedValue({ jobs: [], errors: [] });
      const config = JSON.parse(remoteAutomation.sourceConfig as string);
      config.remote.jsearch = { remoteOnly: false, pagesPerTerm: 3 };

      await runAutomation({
        ...remoteAutomation,
        sourceConfig: JSON.stringify(config),
      });

      expect((searchRemoteFeeds as any).mock.calls[0][1].jsearch).toEqual({
        remoteOnly: false,
        pagesPerTerm: 3,
      });
    });

    it("saves a long country list as one short location", async () => {
      (prisma.location.findUnique as any).mockResolvedValue(null);
      (prisma.location.create as any).mockResolvedValue({ id: "loc-new" });
      (searchRemoteFeeds as any).mockResolvedValue({
        jobs: [
          makeJob("Frontend Engineer", "React", {
            location: "United States, Canada, Mexico, Brazil",
            locationLabel: "Multiple countries",
          }),
        ],
        errors: [],
      });

      await runAutomation(remoteAutomation);

      const created = (prisma.location.create as any).mock.calls[0][0];
      expect(created.data.label).toBe("Multiple countries");
    });

    it("fails with its own reason when no job board is switched on", async () => {
      const result = await runAutomation({
        ...remoteAutomation,
        sourceConfig: JSON.stringify({ remote: { companies: [] } }),
      });

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("no_job_boards");
    });

    it("completes with errors when one feed is down", async () => {
      (searchRemoteFeeds as any).mockResolvedValue({
        jobs: [makeJob("Frontend Engineer", "React", { location: "Worldwide" })],
        errors: [{ token: "jobicy", reason: "Jobicy returned 503" }],
      });

      const result = await runAutomation(remoteAutomation);

      expect(result.status).toBe("completed_with_errors");
      expect(result.jobsSaved).toBe(1);
    });
  });

  it("does not save an analyzed job scoring below the match threshold", async () => {
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "React")],
      errors: [],
    });
    (generateText as any).mockResolvedValue({
      text: "SCORES: match=40 recommendation=weak match\n\n## Summary\nThin fit",
    });

    const result = await runAutomation(leverAutomation);

    expect(result.status).toBe("completed");
    expect(result.jobsProcessed).toBe(1); // analyzed
    expect(result.jobsMatched).toBe(0);
    expect(result.jobsSaved).toBe(0);
    expect((prisma.job.create as any).mock.calls.length).toBe(0);
  });

  it("saves a strong match with a deal breaker straight to Withdrawn", async () => {
    (prisma.userSettings.findUnique as any).mockResolvedValue({
      settings: JSON.stringify({
        dealBreakers: { items: ["must be willing to relocate"], withdraw: true },
      }),
    });
    (prisma.jobStatus.findFirst as any).mockImplementation(async ({ where }: any) =>
      where.value === "withdrawn" ? { id: "st-withdrawn" } : { id: "st" },
    );
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "React")],
      errors: [],
    });
    (generateText as any).mockResolvedValue({
      text: "SCORES: match=90 recommendation=strong\nDEAL_BREAKERS: 1\n\n## Summary\nGreat fit",
    });

    const result = await runAutomation(leverAutomation);

    expect((generateText as any).mock.calls[0][0].instructions).toContain(
      '1. "must be willing to relocate"',
    );
    const createArg = (prisma.job.create as any).mock.calls[0][0];
    expect(createArg.data.statusId).toBe("st-withdrawn");
    expect(JSON.parse(createArg.data.matchData).dealBreakers).toEqual({
      checked: ["must be willing to relocate"],
      found: ["must be willing to relocate"],
      withdrawn: true,
    });
    expect(result.jobsSaved).toBe(1);
    expect(result.jobsMatched).toBe(0);
  });

  it("flags but keeps a deal-broken match as New when withdrawing is off", async () => {
    (prisma.userSettings.findUnique as any).mockResolvedValue({
      settings: JSON.stringify({ dealBreakers: { items: ["travel"], withdraw: false } }),
    });
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "React")],
      errors: [],
    });
    (generateText as any).mockResolvedValue({
      text: "SCORES: match=90 recommendation=strong\nDEAL_BREAKERS: 1\n\n## Summary\nGreat fit",
    });

    const result = await runAutomation(leverAutomation);

    const createArg = (prisma.job.create as any).mock.calls[0][0];
    expect(createArg.data.statusId).toBe("st");
    expect(JSON.parse(createArg.data.matchData).dealBreakers.found).toEqual(["travel"]);
    expect(result.jobsMatched).toBe(1);
  });

  it("persists Lever's workplaceType through to the job record", async () => {
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "React", { workplaceType: "HYBRID" })],
      errors: [],
    });

    await runAutomation(leverAutomation);

    const createArg = (prisma.job.create as any).mock.calls[0][0];
    expect(createArg.data.workplaceType).toBe("HYBRID");
  });

  it("fails cleanly with no_companies when the lever config is empty", async () => {
    const auto = {
      ...leverAutomation,
      sourceConfig: JSON.stringify({ lever: { companies: [] } }),
    };

    const result = await runAutomation(auto);
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("no_companies");
    expect((searchLeverJobs as any).mock.calls.length).toBe(0);
  });

  it("strips HTML and decodes entities from the resume before matching", async () => {
    (prisma.resume.findUnique as any).mockResolvedValue({
      id: "resume1",
      title: "My Resume",
      ContactInfo: null,
      ResumeSections: [
        {
          sectionType: "experience",
          workExperiences: [
            {
              description: "<p>Sales &amp; Marketing</p>",
              startDate: new Date("2020-01-01"),
              endDate: null,
              Company: { label: "Acme" },
              jobTitle: { label: "Engineer" },
              location: { label: "Remote" },
            },
          ],
        },
      ],
    });
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "React")],
      errors: [],
    });

    await runAutomation(leverAutomation);

    const prompt = (generateText as any).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Sales & Marketing");
    expect(prompt).not.toContain("&amp;");
    expect(prompt).not.toContain("<p>");
  });

  it("tags a saved job with the resume skills its posting mentions", async () => {
    (prisma.resume.findUnique as any).mockResolvedValue({
      id: "resume1",
      title: "My Resume",
      ContactInfo: null,
      ResumeSections: [
        {
          sectionType: "skills",
          skills: [
            { category: null, order: 0, Tag: { id: "tag-react", label: "React" } },
            { category: null, order: 1, Tag: { id: "tag-rust", label: "Rust" } },
          ],
        },
      ],
    });
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "We build with React every day")],
      errors: [],
    });

    await runAutomation(leverAutomation);

    const createArg = (prisma.job.create as any).mock.calls[0][0];
    expect(createArg.data.tags).toEqual({ connect: [{ id: "tag-react" }] });
  });

  it("omits tags when the resume has no skills section", async () => {
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "We build with React every day")],
      errors: [],
    });

    await runAutomation(leverAutomation);

    const createArg = (prisma.job.create as any).mock.calls[0][0];
    expect("tags" in createArg.data).toBe(false);
  });

  describe("board failures", () => {
    const twoBoards: Automation = {
      ...leverAutomation,
      sourceConfig: JSON.stringify({
        lever: {
          companies: [
            { name: "Acme", token: "acme" },
            { name: "Globex", token: "globex" },
          ],
          targetTitles: ["Frontend Engineer"],
          keywords: [],
          locations: [],
          strictLocation: false,
        },
      }),
    };

    it("fails the run when every board errored", async () => {
      (searchLeverJobs as any).mockResolvedValue({
        jobs: [],
        errors: [
          { token: "acme", reason: "Board 'acme' returned 404" },
          { token: "globex", reason: "Board 'globex' timed out" },
        ],
      });

      const result = await runAutomation(twoBoards);

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("All 2 boards unreachable");
      const finalizeData = (recordRunNotifications as any).mock.calls[0][1];
      expect(finalizeData.boardErrors).toEqual([
        { token: "acme", name: "Acme", reason: "Board 'acme' returned 404" },
        { token: "globex", name: "Globex", reason: "Board 'globex' timed out" },
      ]);
    });

    it("completes with errors when only some boards errored", async () => {
      (searchLeverJobs as any).mockResolvedValue({
        jobs: [],
        errors: [{ token: "acme", reason: "Board 'acme' returned 404" }],
      });

      const result = await runAutomation(twoBoards);

      // Takes the "nothing new" early return, which must still carry it.
      expect(result.status).toBe("completed_with_errors");
      expect(result.errorMessage).toBe("1 of 2 boards unreachable");
      const finalizeData = (recordRunNotifications as any).mock.calls[0][1];
      expect(finalizeData.boardErrors).toHaveLength(1);
    });

    it("stays completed when no board errored", async () => {
      (searchLeverJobs as any).mockResolvedValue({ jobs: [], errors: [] });
      const result = await runAutomation(twoBoards);
      expect(result.status).toBe("completed");
      expect(result.errorMessage).toBeUndefined();
    });
  });
});
