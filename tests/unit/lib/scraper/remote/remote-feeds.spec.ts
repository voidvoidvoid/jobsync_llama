// Remote job feeds against a stubbed fetch: what each feed is asked for, how
// its payload maps to a job, and how the three combine.
vi.mock("@/lib/constants", async (orig) => {
  const actual = await (orig() as Promise<{ APP_CONSTANTS: object }>);
  return {
    ...actual,
    // No politeness pause between requests under test
    APP_CONSTANTS: { ...actual.APP_CONSTANTS, REMOTE_FEED_REQUEST_DELAY_MS: 0 },
  };
});

import {
  searchRemoteFeeds,
  buildSearchTerms,
  remoteLocationMatches,
} from "@/lib/scraper/remote";
import {
  fetchHimalayasJobs,
  mapHimalayasJob,
} from "@/lib/scraper/remote/himalayas";
import { fetchJobicyJobs, mapJobicyJob } from "@/lib/scraper/remote/jobicy";
import {
  fetchRemoteOkJobs,
  mapRemoteOkJob,
} from "@/lib/scraper/remote/remoteok";
import { runAtsPipeline } from "@/lib/scraper/ats/pipeline";

const himalayasJob = (n: number, extra = {}) => ({
  title: `Data Engineer ${n}`,
  companyName: `Company ${n}`,
  employmentType: "Full Time",
  locationRestrictions: ["United States", "Canada"],
  minSalary: 120000,
  maxSalary: 150000,
  currency: "USD",
  description: "<p>Spark and Airflow</p>",
  pubDate: 1790000000,
  applicationLink: `https://himalayas.app/companies/c${n}/jobs/data-engineer-${n}`,
  guid: `https://himalayas.app/companies/c${n}/jobs/data-engineer-${n}`,
  ...extra,
});

const jobicyJob = (n: number, extra = {}) => ({
  id: n,
  url: `https://jobicy.com/jobs/${n}-data-engineer`,
  jobTitle: `Data Engineer ${n}`,
  companyName: `Jobicy Co ${n}`,
  jobType: ["full-time"],
  jobGeo: "USA",
  jobDescription: "<p>Python</p>",
  pubDate: "2026-11-10T12:00:00+00:00",
  ...extra,
});

const remoteOkJob = (n: number, extra = {}) => ({
  id: String(n),
  position: `Platform Engineer ${n}`,
  company: `ROK Co ${n}`,
  location: "Worldwide",
  description: "<p>Kubernetes</p>",
  date: "2026-11-12T08:00:00+00:00",
  url: `https://remoteOK.com/remote-jobs/remote-platform-engineer-${n}`,
  apply_url: `https://remoteOK.com/l/${n}`,
  salary_min: 0,
  salary_max: 0,
  ...extra,
});

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

// Routes a stubbed fetch by host so the feeds can be read in parallel.
function stubFeeds(handlers: {
  himalayas?: (url: URL) => unknown;
  jobicy?: (url: URL) => unknown;
  remoteok?: (url: URL) => unknown;
}) {
  const fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.hostname === "himalayas.app" && handlers.himalayas)
      return handlers.himalayas(url);
    if (url.hostname === "jobicy.com" && handlers.jobicy)
      return handlers.jobicy(url);
    if (url.hostname === "remoteok.com" && handlers.remoteok)
      return handlers.remoteok(url);
    throw new TypeError("fetch failed");
  });
  global.fetch = fetchMock as never;
  return fetchMock;
}

const urlsFor = (fetchMock: any, host: string) =>
  fetchMock.mock.calls
    .map((call: [string]) => new URL(call[0]))
    .filter((url: URL) => url.hostname === host);

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe("buildSearchTerms", () => {
  it("puts titles before keywords and drops repeats and blanks", () => {
    expect(
      buildSearchTerms({
        targetTitles: ["Data Engineer", "  "],
        keywords: ["Spark", "data  engineer", "Airflow"],
      }),
    ).toEqual(["Data Engineer", "Spark", "Airflow"]);
  });

  it("caps the list at six terms", () => {
    const keywords = Array.from({ length: 10 }, (_, i) => `term${i}`);
    expect(buildSearchTerms({ targetTitles: [], keywords })).toHaveLength(6);
  });

  it("is empty without a query", () => {
    expect(buildSearchTerms()).toEqual([]);
  });
});

describe("remoteLocationMatches", () => {
  it("passes everything when no location is wanted", () => {
    expect(remoteLocationMatches("Germany", [])).toBe(true);
  });

  it.each(["Worldwide", "Anywhere", "", "Remote", "Global"])(
    "always passes a listing open to everyone (%s)",
    (location) => {
      expect(remoteLocationMatches(location, ["United States"])).toBe(true);
    },
  );

  it("passes a listing that names a wanted place", () => {
    expect(remoteLocationMatches("United States, Canada", ["Canada"])).toBe(true);
  });

  it("drops a listing restricted to somewhere else", () => {
    expect(remoteLocationMatches("Germany, France", ["United States"])).toBe(false);
  });

  it("matches the United States under any common spelling", () => {
    expect(remoteLocationMatches("USA", ["United States"])).toBe(true);
    expect(remoteLocationMatches("United States", ["US"])).toBe(true);
  });

  it("does not match a short code inside another word", () => {
    expect(remoteLocationMatches("Australia", ["US"])).toBe(false);
  });
});

describe("mapHimalayasJob", () => {
  it("maps a posting to a remote job credited to Himalayas", () => {
    expect(mapHimalayasJob(himalayasJob(1))).toEqual({
      title: "Data Engineer 1",
      company: "Company 1",
      location: "United States, Canada",
      description: "<p>Spark and Airflow</p>",
      url: "https://himalayas.app/companies/c1/jobs/data-engineer-1",
      postedDate: new Date(1790000000 * 1000).toISOString(),
      salary: "120000–150000 USD",
      employmentType: "Full Time",
      isRemote: true,
      workplaceType: "REMOTE",
      source: "Himalayas",
    });
  });

  it("reads countries given as objects, the shape the live API sends", () => {
    const job = mapHimalayasJob(
      himalayasJob(1, {
        locationRestrictions: [
          { alpha2: "US", name: "United States", slug: "united-states" },
          { alpha2: "CA", name: "Canada", slug: "canada" },
        ],
      }),
    );
    expect(job?.location).toBe("United States, Canada");
  });

  it("calls an unrestricted posting Worldwide", () => {
    const job = mapHimalayasJob(himalayasJob(1, { locationRestrictions: [] }));
    expect(job?.location).toBe("Worldwide");
  });

  it("drops a posting without a usable link", () => {
    expect(
      mapHimalayasJob(himalayasJob(1, { applicationLink: "", guid: "abc" })),
    ).toBeNull();
  });
});

describe("mapJobicyJob", () => {
  it("decodes entity-encoded titles and keeps the Jobicy link", () => {
    const job = mapJobicyJob(
      jobicyJob(7, { jobTitle: "R&amp;D Engineer", companyName: "A &amp; B" }),
    );
    expect(job).toMatchObject({
      title: "R&D Engineer",
      company: "A & B",
      location: "USA",
      url: "https://jobicy.com/jobs/7-data-engineer",
      employmentType: "full-time",
      workplaceType: "REMOTE",
      source: "Jobicy",
    });
  });
});

describe("mapRemoteOkJob", () => {
  it("links back to the posting on Remote OK, not the apply redirect", () => {
    const job = mapRemoteOkJob(remoteOkJob(3, { location: "Berlin, " }));
    expect(job).toMatchObject({
      title: "Platform Engineer 3",
      url: "https://remoteOK.com/remote-jobs/remote-platform-engineer-3",
      location: "Berlin",
      source: "Remote OK",
    });
    // Zero means "not disclosed" on this feed
    expect(job?.salary).toBeUndefined();
  });

  it("is null for the legal notice that leads the feed", () => {
    expect(
      mapRemoteOkJob({ last_updated: 1, legal: "API Terms..." } as never),
    ).toBeNull();
  });
});

describe("fetchHimalayasJobs", () => {
  it("searches each term, newest first, and stops at a short page", async () => {
    const fetchMock = stubFeeds({
      himalayas: (url) => {
        const page = Number(url.searchParams.get("page"));
        // "spark": a full first page, then a short second; "airflow": short
        const full = url.searchParams.get("q") === "spark" && page === 1;
        const count = full ? 20 : 3;
        const base = url.searchParams.get("q") === "spark" ? page * 100 : 900;
        return ok({
          jobs: Array.from({ length: count }, (_, i) => himalayasJob(base + i)),
        });
      },
    });

    const result = await fetchHimalayasJobs(["spark", "airflow"]);

    const urls = urlsFor(fetchMock, "himalayas.app");
    expect(urls.map((u: URL) => `${u.pathname}?${u.searchParams}`)).toEqual([
      "/jobs/api/search?q=spark&sort=recent&page=1",
      "/jobs/api/search?q=spark&sort=recent&page=2",
      "/jobs/api/search?q=airflow&sort=recent&page=1",
    ]);
    expect(result.success && result.data).toHaveLength(26);
  });

  it("browses the newest postings when there are no terms", async () => {
    const fetchMock = stubFeeds({
      himalayas: () => ok({ jobs: [himalayasJob(1)] }),
    });

    await fetchHimalayasJobs([]);

    const [url] = urlsFor(fetchMock, "himalayas.app");
    expect(`${url.pathname}?${url.searchParams}`).toBe("/jobs/api?limit=20");
  });

  it("identifies itself and never sends a key", async () => {
    const fetchMock = stubFeeds({ himalayas: () => ok({ jobs: [] }) });

    await fetchHimalayasJobs(["spark"]);

    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers["User-Agent"]).toContain("JobSync");
    expect(headers.Authorization).toBeUndefined();
  });

  it("reports a rate limit on the first request", async () => {
    stubFeeds({ himalayas: () => ({ ok: false, status: 429 }) });

    const result = await fetchHimalayasJobs(["spark"]);

    expect(result).toEqual({ success: false, error: { type: "rate_limited" } });
  });

  it("keeps what it fetched when a later request fails", async () => {
    let calls = 0;
    stubFeeds({
      himalayas: () =>
        ++calls === 1
          ? ok({ jobs: [himalayasJob(1)] })
          : { ok: false, status: 429 },
    });

    const result = await fetchHimalayasJobs(["spark", "airflow"]);

    expect(result.success && result.data).toHaveLength(1);
  });

  it("rejects a body without a jobs list", async () => {
    stubFeeds({ himalayas: () => ok({ message: "nope" }) });

    const result = await fetchHimalayasJobs(["spark"]);

    expect(result.success).toBe(false);
    expect(!result.success && result.error).toMatchObject({ type: "parse" });
  });
});

describe("fetchJobicyJobs", () => {
  it("sends the first three usable terms as tag searches", async () => {
    const fetchMock = stubFeeds({ jobicy: () => ok({ jobs: [jobicyJob(1)] }) });

    // "Go" is under Jobicy's three-character minimum
    await fetchJobicyJobs(["Go", "Data Engineer", "Spark", "Airflow", "dbt"]);

    const urls = urlsFor(fetchMock, "jobicy.com");
    expect(urls.map((u: URL) => u.searchParams.get("tag"))).toEqual([
      "Data Engineer",
      "Spark",
      "Airflow",
    ]);
    expect(urls[0].searchParams.get("count")).toBe("100");
  });

  it("asks for the newest postings when no term is usable", async () => {
    const fetchMock = stubFeeds({ jobicy: () => ok({ jobs: [] }) });

    await fetchJobicyJobs(["Go"]);

    const urls = urlsFor(fetchMock, "jobicy.com");
    expect(urls).toHaveLength(1);
    expect(urls[0].searchParams.has("tag")).toBe(false);
  });

  it("reports the status when the feed is down", async () => {
    stubFeeds({ jobicy: () => ({ ok: false, status: 503 }) });

    const result = await fetchJobicyJobs(["spark"]);

    expect(!result.success && result.error).toEqual({
      type: "network",
      message: "Jobicy returned 503",
    });
  });
});

describe("fetchRemoteOkJobs", () => {
  it("reads the whole feed in one request and skips the legal notice", async () => {
    const fetchMock = stubFeeds({
      remoteok: () =>
        ok([{ last_updated: 1, legal: "terms" }, remoteOkJob(1), remoteOkJob(2)]),
    });

    const result = await fetchRemoteOkJobs();

    expect(urlsFor(fetchMock, "remoteok.com")).toHaveLength(1);
    expect(result.success && result.data.map((j) => j.title)).toEqual([
      "Platform Engineer 1",
      "Platform Engineer 2",
    ]);
  });
});

describe("searchRemoteFeeds", () => {
  const feeds = [
    { name: "Himalayas", token: "himalayas" },
    { name: "Jobicy", token: "jobicy" },
    { name: "Remote OK", token: "remoteok" },
  ];
  const query = { targetTitles: ["Data Engineer"], keywords: [] };

  it("combines the selected feeds and credits each listing's source", async () => {
    stubFeeds({
      himalayas: () => ok({ jobs: [himalayasJob(1)] }),
      jobicy: () => ok({ jobs: [jobicyJob(2)] }),
      remoteok: () => ok([{ legal: "terms" }, remoteOkJob(3)]),
    });

    const { jobs, errors } = await searchRemoteFeeds(feeds, query);

    expect(errors).toEqual([]);
    expect(jobs.map((j) => j.source)).toEqual(["Himalayas", "Jobicy", "Remote OK"]);
    expect(jobs.every((j) => j.workplaceType === "REMOTE")).toBe(true);
  });

  it("only reads the feeds that are turned on", async () => {
    const fetchMock = stubFeeds({
      himalayas: () => ok({ jobs: [] }),
      jobicy: () => ok({ jobs: [jobicyJob(2)] }),
      remoteok: () => ok([]),
    });

    await searchRemoteFeeds([{ name: "Jobicy", token: "jobicy" }], query);

    expect(urlsFor(fetchMock, "himalayas.app")).toHaveLength(0);
    expect(urlsFor(fetchMock, "remoteok.com")).toHaveLength(0);
    expect(urlsFor(fetchMock, "jobicy.com")).toHaveLength(1);
  });

  it("keeps one copy of a posting listed on two feeds", async () => {
    stubFeeds({
      himalayas: () =>
        ok({ jobs: [himalayasJob(1, { title: "Data Engineer", companyName: "Acme Inc." })] }),
      jobicy: () =>
        ok({ jobs: [jobicyJob(2, { jobTitle: "Data Engineer", companyName: "Acme" })] }),
      remoteok: () => ok([]),
    });

    const { jobs } = await searchRemoteFeeds(feeds, query);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].source).toBe("Himalayas");
  });

  it("keeps one copy of a posting found under two search terms", async () => {
    stubFeeds({ himalayas: () => ok({ jobs: [himalayasJob(1)] }) });

    const { jobs } = await searchRemoteFeeds(
      [{ name: "Himalayas", token: "himalayas" }],
      { targetTitles: ["Data Engineer"], keywords: ["Spark"] },
    );

    expect(jobs).toHaveLength(1);
  });

  it("reports a failed feed by token and still returns the others", async () => {
    stubFeeds({
      himalayas: () => ({ ok: false, status: 500 }),
      jobicy: () => ok({ jobs: [jobicyJob(2)] }),
      // remoteok has no handler: the stub throws, as an unreachable host would
    });

    const { jobs, errors } = await searchRemoteFeeds(feeds, query);

    expect(jobs).toHaveLength(1);
    expect(errors).toEqual([
      { token: "himalayas", reason: "Himalayas returned 500" },
      { token: "remoteok", reason: "fetch failed" },
    ]);
  });
});

describe("runAtsPipeline with the remote location test", () => {
  const job = (title: string, location: string) => ({
    title,
    company: "Acme",
    location,
    description: "Spark pipelines",
    url: `https://example.com/${title}`,
  });
  const config = {
    targetTitles: ["Data Engineer"],
    keywords: ["Spark"],
    locations: ["United States"],
    strictLocation: true,
  };
  const jobs = [
    job("Data Engineer A", "Worldwide"),
    job("Data Engineer B", "USA"),
    job("Data Engineer C", "Germany"),
  ];

  it("keeps worldwide and matching roles, drops roles restricted elsewhere", () => {
    const result = runAtsPipeline(jobs, config, [], {
      locationMatcher: remoteLocationMatches,
    });
    expect(result.funnel.located).toBe(2);
  });

  it("still uses the plain text match for company boards", () => {
    // No custom matcher: "Worldwide" and "USA" do not contain "United States"
    expect(runAtsPipeline(jobs, config, []).funnel.located).toBe(0);
  });
});
