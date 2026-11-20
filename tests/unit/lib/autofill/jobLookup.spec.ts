import { describe, it, expect } from "vitest";
import { jobKeysFromUrl } from "@/lib/autofill/jobLookup";

describe("jobKeysFromUrl", () => {
  it("finds the same Greenhouse job on its board, its embed and the company site", () => {
    const a = jobKeysFromUrl("https://job-boards.greenhouse.io/acme/jobs/4012345007");
    const b = jobKeysFromUrl("https://boards.greenhouse.io/embed/job_app?for=acme&token=4012345007");
    const c = jobKeysFromUrl("https://www.acme.com/careers/job?gh_jid=4012345007");
    for (const keys of [a, b, c]) expect(keys).toContain("greenhouse:4012345007");
  });

  it("treats a Lever or Ashby /apply page as the posting", () => {
    const id = "0b9c7e4e-1d2f-4a3b-9c8d-7e6f5a4b3c2d";
    expect(jobKeysFromUrl(`https://jobs.lever.co/acme/${id}/apply`)).toContain(`lever:${id}`);
    expect(jobKeysFromUrl(`https://jobs.ashbyhq.com/acme/${id}/application`)).toContain(`ashby:${id}`);
  });

  it("falls back to host and path, without query or /apply", () => {
    expect(jobKeysFromUrl("https://www.example.com/jobs/123-dev/apply?src=x#top")).toEqual([
      "url:example.com/jobs/123-dev",
    ]);
    expect(jobKeysFromUrl("not a url")).toEqual([]);
  });
});
