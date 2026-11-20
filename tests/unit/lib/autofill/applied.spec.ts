import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  default: {
    job: { findFirst: vi.fn() },
    jobStatus: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/jobs/timeline", () => ({ changeJobStatus: vi.fn() }));
vi.mock("@/lib/jobs/createJobFromNames", () => ({ createJobFromNames: vi.fn() }));

import db from "@/lib/db";
import { changeJobStatus } from "@/lib/jobs/timeline";
import { createJobFromNames } from "@/lib/jobs/createJobFromNames";
import { markJobApplied } from "@/lib/autofill/applied";

const mdb = db as any;

describe("markJobApplied", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mdb.jobStatus.findFirst.mockResolvedValue({ id: "st-applied" });
  });

  it("moves a saved New job to Applied", async () => {
    mdb.job.findFirst.mockResolvedValue({ id: "j1", Status: { value: "new" } });
    const r = await markJobApplied("u1", { jobId: "j1" });
    expect(r).toMatchObject({ ok: true, changed: true, created: false });
    expect(mdb.job.findFirst.mock.calls[0][0].where).toEqual({ id: "j1", userId: "u1" });
    expect(changeJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "j1", userId: "u1", statusId: "st-applied" }),
    );
  });

  it("never pulls a later stage back to Applied", async () => {
    mdb.job.findFirst.mockResolvedValue({ id: "j1", Status: { value: "interview" } });
    const r = await markJobApplied("u1", { jobId: "j1" });
    expect(r).toMatchObject({ ok: true, changed: false });
    expect(changeJobStatus).not.toHaveBeenCalled();
  });

  it("refuses another user's job", async () => {
    mdb.job.findFirst.mockResolvedValue(null);
    expect(await markJobApplied("u1", { jobId: "j2" })).toMatchObject({ ok: false });
  });

  it("adds an unsaved job as Applied", async () => {
    vi.mocked(createJobFromNames).mockResolvedValue({ created: true, jobId: "new1", resolutions: [], message: "ok" });
    const r = await markJobApplied("u1", {
      url: "https://x.test/jobs/1",
      jobTitle: " Dev ",
      company: "Acme",
      description: "short",
    });
    expect(r).toMatchObject({ ok: true, created: true, jobId: "new1" });
    expect(createJobFromNames).toHaveBeenCalledWith(
      expect.objectContaining({ jobTitle: "Dev", company: "Acme", status: "applied", applied: true, jobDescription: "N/A" }),
      "u1",
    );
  });

  it("marks the existing job when the new one would be a duplicate", async () => {
    vi.mocked(createJobFromNames).mockResolvedValue({
      created: false,
      duplicateOf: { id: "j9", title: "Dev", company: "Acme" },
      resolutions: [],
      message: "dup",
    });
    mdb.job.findFirst.mockResolvedValue({ id: "j9", Status: { value: "draft" } });
    const r = await markJobApplied("u1", { url: "https://x.test", jobTitle: "Dev", company: "Acme" });
    expect(r).toMatchObject({ ok: true, jobId: "j9", changed: true });
  });
});
