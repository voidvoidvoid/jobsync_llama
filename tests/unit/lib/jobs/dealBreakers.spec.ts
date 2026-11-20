import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  default: {
    userSettings: { findUnique: vi.fn() },
    jobStatus: { findFirst: vi.fn() },
    job: { findFirst: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/jobs/timeline", () => ({ changeJobStatus: vi.fn() }));

import db from "@/lib/db";
import { changeJobStatus } from "@/lib/jobs/timeline";
import {
  getUserDealBreakers,
  withdrawForDealBreakers,
} from "@/lib/jobs/dealBreakers";

const mdb = db as any;
const settings = { items: ["occasional travel"], withdraw: true };
const hit = { checked: ["occasional travel"], found: ["occasional travel"] };

describe("getUserDealBreakers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defaults to an empty list with withdraw on", async () => {
    mdb.userSettings.findUnique.mockResolvedValue(null);
    expect(await getUserDealBreakers("u1")).toEqual({ items: [], withdraw: true });
  });

  it("reads the saved list", async () => {
    mdb.userSettings.findUnique.mockResolvedValue({
      settings: JSON.stringify({ dealBreakers: { items: ["travel"], withdraw: false } }),
    });
    expect(await getUserDealBreakers("u1")).toEqual({ items: ["travel"], withdraw: false });
    expect(mdb.userSettings.findUnique).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });
});

describe("withdrawForDealBreakers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mdb.jobStatus.findFirst.mockResolvedValue({ id: "withdrawn-id" });
  });

  it("moves a New job to Withdrawn and stamps the match", async () => {
    mdb.job.findFirst
      .mockResolvedValueOnce({ Status: { value: "new" } })
      .mockResolvedValueOnce({ matchData: JSON.stringify({ dealBreakers: hit }) });
    const done = await withdrawForDealBreakers({
      jobId: "j1",
      userId: "u1",
      dealBreakers: hit,
      settings,
    });
    expect(done).toBe(true);
    expect(changeJobStatus).toHaveBeenCalledWith({
      jobId: "j1",
      userId: "u1",
      statusId: "withdrawn-id",
    });
    const saved = JSON.parse(mdb.job.update.mock.calls[0][0].data.matchData);
    expect(saved.dealBreakers.withdrawn).toBe(true);
    expect(mdb.job.update.mock.calls[0][0].where).toEqual({ id: "j1", userId: "u1" });
  });

  it.each(["applied", "interview", "offer", "rejected"])(
    "leaves a job in %s alone",
    async (value) => {
      mdb.job.findFirst.mockResolvedValueOnce({ Status: { value } });
      expect(
        await withdrawForDealBreakers({ jobId: "j1", userId: "u1", dealBreakers: hit, settings }),
      ).toBe(false);
      expect(changeJobStatus).not.toHaveBeenCalled();
    },
  );

  it("does nothing when withdraw is off or nothing was found", async () => {
    expect(
      await withdrawForDealBreakers({
        jobId: "j1",
        userId: "u1",
        dealBreakers: hit,
        settings: { ...settings, withdraw: false },
      }),
    ).toBe(false);
    expect(
      await withdrawForDealBreakers({
        jobId: "j1",
        userId: "u1",
        dealBreakers: { ...hit, found: [] },
        settings,
      }),
    ).toBe(false);
    expect(
      await withdrawForDealBreakers({ jobId: "j1", userId: "u1", dealBreakers: undefined, settings }),
    ).toBe(false);
    expect(mdb.job.findFirst).not.toHaveBeenCalled();
  });

  it("swallows a failed status change", async () => {
    mdb.job.findFirst.mockResolvedValueOnce({ Status: { value: "draft" } });
    vi.mocked(changeJobStatus).mockRejectedValueOnce(new Error("boom"));
    expect(
      await withdrawForDealBreakers({ jobId: "j1", userId: "u1", dealBreakers: hit, settings }),
    ).toBe(false);
  });
});
