// JSearch against a stubbed fetch: which key and host it uses, what it asks
// for, how many requests a run costs, and how results map to jobs.
vi.mock("@/lib/constants", async (orig) => {
  const actual = await (orig() as Promise<{ APP_CONSTANTS: object }>);
  return {
    ...actual,
    APP_CONSTANTS: { ...actual.APP_CONSTANTS, REMOTE_FEED_REQUEST_DELAY_MS: 0 },
  };
});
vi.mock("@/lib/api-key-resolver", () => ({ resolveApiKey: vi.fn() }));

import { resolveApiKey } from "@/lib/api-key-resolver";
import {
  fetchJSearchJobs,
  mapJSearchJob,
  resolveJSearchKey,
} from "@/lib/scraper/remote/jsearch";
import { searchRemoteFeeds } from "@/lib/scraper/remote";
import { errorReason } from "@/lib/scraper/utils";
import { classifyBoardError } from "@/lib/notifications/boardError";

const job = (n: number, extra = {}) => ({
  job_id: `id-${n}`,
  job_title: `Data Engineer ${n}`,
  employer_name: `Acme ${n}`,
  job_publisher: "LinkedIn",
  job_apply_link: `https://www.linkedin.com/jobs/view/${n}`,
  job_description: "Spark and Airflow",
  job_is_remote: true,
  job_posted_at_datetime_utc: "2026-11-17T12:00:00.000Z",
  job_city: null,
  job_state: null,
  job_country: "US",
  job_employment_type: "Full-time",
  job_min_salary: 120000,
  job_max_salary: 150000,
  job_salary_period: "YEAR",
  ...extra,
});

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const page = (count: number, start = 0, extra = {}) => ({
  status: "OK",
  data: Array.from({ length: count }, (_, i) => job(start + i)),
  ...extra,
});

function keys(direct?: string, rapid?: string) {
  (resolveApiKey as any).mockImplementation(async (_: string, id: string) =>
    id === "jsearch" ? direct : id === "jsearch-rapidapi" ? rapid : undefined,
  );
}

const call = (fetchMock: any, i = 0) => {
  const [url, init] = fetchMock.mock.calls[i];
  return { url: new URL(url), headers: init.headers as Record<string, string> };
};

const originalFetch = global.fetch;
beforeEach(() => (resolveApiKey as any).mockReset());
afterEach(() => {
  global.fetch = originalFetch;
});

describe("resolveJSearchKey", () => {
  it("prefers a direct OpenWeb Ninja key over a RapidAPI one", async () => {
    keys("direct-key", "rapid-key");
    expect(await resolveJSearchKey("u1")).toEqual({ key: "direct-key", via: "direct" });
  });

  it("falls back to the RapidAPI key", async () => {
    keys(undefined, "rapid-key");
    expect(await resolveJSearchKey("u1")).toEqual({ key: "rapid-key", via: "rapidapi" });
  });

  it("is null with neither", async () => {
    keys();
    expect(await resolveJSearchKey("u1")).toBeNull();
  });
});

describe("fetchJSearchJobs – direct key", () => {
  it("searches remote roles from the last week by default", async () => {
    keys("direct-key");
    const fetchMock = vi.fn().mockResolvedValue(ok(page(3)));
    global.fetch = fetchMock as never;

    const result = await fetchJSearchJobs(["Data Engineer"], "u1");

    const { url, headers } = call(fetchMock);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://api.openwebninja.com/jsearch/search-v2",
    );
    expect(url.searchParams.get("query")).toBe("Data Engineer");
    expect(url.searchParams.get("work_from_home")).toBe("true");
    expect(url.searchParams.get("date_posted")).toBe("week");
    expect(headers["x-api-key"]).toBe("direct-key");
    expect(headers["X-RapidAPI-Key"]).toBeUndefined();
    expect(result.success && result.data).toHaveLength(3);
  });

  it("leaves the remote filter off when the automation turns it off", async () => {
    keys("direct-key");
    const fetchMock = vi.fn().mockResolvedValue(ok(page(1)));
    global.fetch = fetchMock as never;

    await fetchJSearchJobs(["Data Engineer"], "u1", { remoteOnly: false });

    expect(call(fetchMock).url.searchParams.has("work_from_home")).toBe(false);
  });

  it("costs one request per term per page, following the cursor", async () => {
    keys("direct-key");
    const fetchMock = vi
      .fn()
      .mockImplementation(async (url: string) =>
        ok(page(10, 0, { cursor: new URL(url).searchParams.get("cursor") ? "c3" : "c2" })),
      );
    global.fetch = fetchMock as never;

    await fetchJSearchJobs(["Data Engineer", "Spark"], "u1", { pagesPerTerm: 3 });

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(call(fetchMock, 1).url.searchParams.get("cursor")).toBe("c2");
    // a new term starts again without a cursor
    expect(call(fetchMock, 3).url.searchParams.has("cursor")).toBe(false);
  });

  it("stops paging a term when the results run out", async () => {
    keys("direct-key");
    const fetchMock = vi.fn().mockResolvedValue(ok(page(4, 0, { cursor: "c2" })));
    global.fetch = fetchMock as never;

    await fetchJSearchJobs(["Data Engineer"], "u1", { pagesPerTerm: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchJSearchJobs – RapidAPI key", () => {
  it("asks for every page in one request on the RapidAPI host", async () => {
    keys(undefined, "rapid-key");
    const fetchMock = vi.fn().mockResolvedValue(ok(page(25)));
    global.fetch = fetchMock as never;

    const result = await fetchJSearchJobs(["Data Engineer"], "u1", { pagesPerTerm: 3 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, headers } = call(fetchMock);
    expect(`${url.origin}${url.pathname}`).toBe("https://jsearch.p.rapidapi.com/search");
    expect(url.searchParams.get("num_pages")).toBe("3");
    expect(url.searchParams.get("page")).toBe("1");
    expect(headers["X-RapidAPI-Key"]).toBe("rapid-key");
    expect(headers["X-RapidAPI-Host"]).toBe("jsearch.p.rapidapi.com");
    expect(result.success && result.data).toHaveLength(25);
  });
});

describe("fetchJSearchJobs – failures", () => {
  it("fails with an API-key reason when no key is set, without calling out", async () => {
    keys();
    const fetchMock = vi.fn();
    global.fetch = fetchMock as never;

    const result = await fetchJSearchJobs(["Data Engineer"], "u1");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    const reason = errorReason((result as any).error);
    expect(reason).toMatch(/API key/);
    // ...which the notification list words as a key problem
    expect(classifyBoardError(reason)).toBe("auth");
  });

  it("reports a rejected key as a key problem", async () => {
    keys("bad-key");
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 }) as never;

    const result = await fetchJSearchJobs(["Data Engineer"], "u1");

    expect(classifyBoardError(errorReason((result as any).error))).toBe("auth");
  });

  it("reports a spent allowance as rate limited", async () => {
    keys("direct-key");
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 }) as never;

    const result = await fetchJSearchJobs(["Data Engineer"], "u1");

    expect(result).toEqual({ success: false, error: { type: "rate_limited" } });
  });

  it("keeps earlier terms' results when a later request fails", async () => {
    keys("direct-key");
    let n = 0;
    global.fetch = vi
      .fn()
      .mockImplementation(async () => (++n === 1 ? ok(page(2)) : { ok: false, status: 429 })) as never;

    const result = await fetchJSearchJobs(["Data Engineer", "Spark"], "u1");

    expect(result.success && result.data).toHaveLength(2);
  });

  it("needs a search term and spends nothing without one", async () => {
    keys("direct-key");
    const fetchMock = vi.fn();
    global.fetch = fetchMock as never;

    const result = await fetchJSearchJobs([], "u1");

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("mapJSearchJob", () => {
  it("credits the site the listing came from and keeps its link", () => {
    expect(mapJSearchJob(job(1), true)).toEqual({
      title: "Data Engineer 1",
      company: "Acme 1",
      location: "US",
      locationLabel: undefined,
      description: "Spark and Airflow",
      url: "https://www.linkedin.com/jobs/view/1",
      postedDate: "2026-11-17T12:00:00.000Z",
      salary: "120000–150000 / year",
      employmentType: "Full-time",
      isRemote: true,
      workplaceType: "REMOTE",
      source: "LinkedIn",
    });
  });

  it("drops a listing marked not remote when remote-only is on", () => {
    expect(mapJSearchJob(job(1, { job_is_remote: false }), true)).toBeNull();
  });

  it("keeps an on-site listing, marked as such, when remote-only is off", () => {
    const mapped = mapJSearchJob(
      job(1, { job_is_remote: false, job_city: "Austin", job_state: "TX" }),
      false,
    );
    expect(mapped).toMatchObject({
      location: "Austin, TX, US",
      isRemote: false,
      workplaceType: undefined,
    });
  });
});

describe("searchRemoteFeeds with JSearch", () => {
  it("passes the user and the automation's JSearch settings through", async () => {
    keys("direct-key");
    const fetchMock = vi.fn().mockResolvedValue(ok(page(2)));
    global.fetch = fetchMock as never;

    const { jobs, errors } = await searchRemoteFeeds(
      [{ name: "JSearch", token: "jsearch" }],
      {
        targetTitles: ["Data Engineer"],
        keywords: [],
        userId: "u1",
        jsearch: { datePosted: "3days" },
      },
    );

    expect(errors).toEqual([]);
    expect(jobs).toHaveLength(2);
    expect(resolveApiKey).toHaveBeenCalledWith("u1", "jsearch");
    expect(call(fetchMock).url.searchParams.get("date_posted")).toBe("3days");
  });
});
