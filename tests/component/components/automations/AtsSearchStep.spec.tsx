import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AtsSearchStep } from "@/components/automations/AtsSearchStep";
import { toastInfo } from "@/lib/toast";

vi.mock("@/actions/atsCompany.actions", () => ({
  searchAtsCompanies: vi
    .fn()
    .mockResolvedValue({ companies: [], hasMore: false }),
  getAtsCompanyCount: vi.fn().mockResolvedValue(0),
  resolveAtsBoard: vi.fn(),
}));

vi.mock("@/actions/company.actions", () => ({
  getWatchedBoards: vi.fn().mockResolvedValue([
    { id: "1", name: "Acme", token: "acme", provider: "greenhouse" },
    { id: "2", name: "Beta", token: "beta", provider: "greenhouse" },
    { id: "3", name: "Gamma", token: "gamma", provider: "greenhouse" },
  ]),
}));

// TargetingFields pulls four entity actions for its chip inputs; all four must
// be mocked or the module throws at import.
vi.mock("@/actions/jobtitle.actions", () => ({
  getAllJobTitles: vi.fn().mockResolvedValue([]),
  createJobTitle: vi.fn(),
}));

vi.mock("@/actions/tag.actions", () => ({
  getAllTags: vi.fn().mockResolvedValue([]),
  createTag: vi.fn(),
}));

vi.mock("@/actions/jobLocation.actions", () => ({
  getAllJobLocations: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/actions/job.actions", () => ({
  createLocation: vi.fn(),
}));

const getUserApiKeys = vi.fn().mockResolvedValue({ success: true, data: [] });
vi.mock("@/actions/apiKey.actions", () => ({
  getUserApiKeys: () => getUserApiKeys(),
}));

vi.mock("@/lib/toast", () => ({
  toastInfo: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

// Required by Radix UI Popover / Command components
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn();

document.createRange = () => {
  const range = new Range();
  range.getBoundingClientRect = vi.fn().mockReturnValue({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
  });
  range.getClientRects = () => ({
    item: () => null,
    length: 0,
    [Symbol.iterator]: vi.fn(),
  });
  return range;
};

describe("AtsSearchStep batch add", () => {
  const user = userEvent.setup();

  const openPicker = async (companies: any[] = []) => {
    const onChange = vi.fn();
    render(
      <AtsSearchStep
        provider="greenhouse"
        value={{ companies } as any}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /search companies/i }));
    return onChange;
  };

  const clickAddAll = async () => {
    await user.click(
      await screen.findByRole("button", { name: /add all watched/i }),
    );
  };

  it("adds every watched board in exactly one onChange", async () => {
    const onChange = await openPicker();

    await clickAddAll();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].companies).toHaveLength(3);
    expect(onChange.mock.calls[0][0].companies.map((c: any) => c.token)).toEqual(
      ["acme", "beta", "gamma"],
    );
  });

  it("dedupes against the current selection by token", async () => {
    const onChange = await openPicker([{ name: "Acme", token: "acme" }]);

    await clickAddAll();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].companies.map((c: any) => c.token)).toEqual(
      ["acme", "beta", "gamma"],
    );
  });

  it("slices to the remaining slots at the 25 cap", async () => {
    const existing = Array.from({ length: 24 }, (_, i) => ({
      name: `C${i}`,
      token: `c${i}`,
    }));
    const onChange = await openPicker(existing);

    await clickAddAll();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].companies).toHaveLength(25);
  });

  it("reports how many were skipped at the cap", async () => {
    const existing = Array.from({ length: 24 }, (_, i) => ({
      name: `C${i}`,
      token: `c${i}`,
    }));
    await openPicker(existing);

    await clickAddAll();

    expect(toastInfo).toHaveBeenCalledWith(expect.stringMatching(/2 skipped/i));
  });
});

describe("AtsSearchStep on the remote board", () => {
  const user = userEvent.setup();
  const allFeeds = [
    { name: "Himalayas", token: "himalayas" },
    { name: "Jobicy", token: "jobicy" },
    { name: "Remote OK", token: "remoteok" },
  ];

  it("offers job boards to switch on, not a company picker", () => {
    render(
      <AtsSearchStep
        provider="remote"
        value={{ companies: allFeeds } as any}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /search companies/i }),
    ).not.toBeInTheDocument();
    for (const name of ["Himalayas", "Jobicy", "Remote OK"]) {
      expect(screen.getByRole("switch", { name })).toBeChecked();
    }
    // Boards that are offered but not in this automation show as off
    for (const name of ["We Work Remotely", "Working Nomads", "Arbeitnow", "JSearch"]) {
      expect(screen.getByRole("switch", { name })).not.toBeChecked();
    }
    expect(screen.getByText("Where you can work from")).toBeInTheDocument();
  });

  it("removes a job board that is switched off", async () => {
    const onChange = vi.fn();
    render(
      <AtsSearchStep
        provider="remote"
        value={{ companies: allFeeds } as any}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("switch", { name: "Jobicy" }));

    expect(onChange.mock.calls[0][0].companies).toEqual([
      { name: "Himalayas", token: "himalayas" },
      { name: "Remote OK", token: "remoteok" },
    ]);
  });

  it("says so when every job board is off", () => {
    render(
      <AtsSearchStep
        provider="remote"
        value={{ companies: [] } as any}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Turn on at least one job board."),
    ).toBeInTheDocument();
  });
});

describe("AtsSearchStep — JSearch settings", () => {
  const user = userEvent.setup();
  const withJSearch = (extra = {}) =>
    ({
      companies: [{ name: "JSearch", token: "jsearch" }],
      targetTitles: ["Data Engineer"],
      keywords: ["Spark", "Airflow"],
      ...extra,
    }) as any;

  beforeEach(() => {
    getUserApiKeys.mockReset();
    getUserApiKeys.mockResolvedValue({ success: true, data: [] });
  });

  it("is off by default and shows no settings until switched on", () => {
    render(
      <AtsSearchStep
        provider="remote"
        value={{ companies: [{ name: "Himalayas", token: "himalayas" }] } as any}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("switch", { name: "JSearch" })).not.toBeChecked();
    expect(
      screen.queryByRole("switch", { name: "Remote roles only" }),
    ).not.toBeInTheDocument();
  });

  it("starts remote-only, and shows what a run costs against the free plan", async () => {
    render(
      <AtsSearchStep provider="remote" value={withJSearch()} onChange={vi.fn()} />,
    );

    expect(screen.getByRole("switch", { name: "Remote roles only" })).toBeChecked();
    expect(screen.getByTestId("jsearch-usage").textContent).toMatch(
      /Each run uses 3 requests \(3 search terms × 1\), about 90 a month.*free plan allows 200/,
    );
    await waitFor(() => expect(getUserApiKeys).toHaveBeenCalled());
  });

  it("warns that more results need a paid plan", () => {
    render(
      <AtsSearchStep
        provider="remote"
        value={withJSearch({ jsearch: { pagesPerTerm: 5 } })}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("jsearch-usage").textContent).toMatch(
      /15 requests.*about 450 a month.*needs a paid plan/,
    );
  });

  it("saves remote-only off as an explicit setting", async () => {
    const onChange = vi.fn();
    render(
      <AtsSearchStep provider="remote" value={withJSearch()} onChange={onChange} />,
    );

    await user.click(screen.getByRole("switch", { name: "Remote roles only" }));

    expect(onChange.mock.calls[0][0].jsearch).toEqual({
      remoteOnly: false,
      pagesPerTerm: 1,
      datePosted: "week",
    });
  });

  it("points to API Keys when no JSearch key is saved", async () => {
    render(
      <AtsSearchStep provider="remote" value={withJSearch()} onChange={vi.fn()} />,
    );

    const link = await screen.findByRole("link", { name: /Settings → API Keys/ });
    expect(link).toHaveAttribute("href", "/dashboard/settings?section=api-keys");
  });

  it("says nothing about keys when one is saved", async () => {
    getUserApiKeys.mockResolvedValue({
      success: true,
      data: [{ provider: "jsearch-rapidapi" }],
    });
    render(
      <AtsSearchStep provider="remote" value={withJSearch()} onChange={vi.fn()} />,
    );

    await waitFor(() => expect(getUserApiKeys).toHaveBeenCalled());
    expect(screen.queryByText(/No JSearch key is saved/)).not.toBeInTheDocument();
  });
});


describe("AtsSearchStep — exclude keywords", () => {
  const user = userEvent.setup();
  const base = { companies: [{ name: "Acme", token: "acme" }] } as any;

  it("adds a word as plain text, without creating a tag", async () => {
    const { createTag } = await import("@/actions/tag.actions");
    const onChange = vi.fn();
    render(<AtsSearchStep provider="greenhouse" value={base} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /e\.g\., Senior, Clearance/ }));
    await user.type(screen.getByPlaceholderText("Type a word to exclude..."), "Clearance");
    await user.click(await screen.findByText('Add "Clearance"'));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ excludeKeywords: ["Clearance"] }),
      ),
    );
    expect(createTag).not.toHaveBeenCalled();
  });

  it("asks where to look only once there are words, defaulting to title and description", async () => {
    const { rerender } = render(
      <AtsSearchStep provider="greenhouse" value={base} onChange={vi.fn()} />,
    );
    expect(screen.queryByText("Look for excluded words in")).toBeNull();

    const onChange = vi.fn();
    rerender(
      <AtsSearchStep
        provider="greenhouse"
        value={{ ...base, excludeKeywords: ["Senior"] }}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("radio", { name: "Title and description" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Title only" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ excludeIn: "title" }),
    );
  });
});
