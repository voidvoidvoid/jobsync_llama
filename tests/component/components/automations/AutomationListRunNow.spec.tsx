// "Run now" on the automations list: starts the same background run as the
// automation page, follows it, and reports the result.
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AutomationList } from "@/components/automations/AutomationList";
import type { AutomationWithResume } from "@/models/automation.model";
import { getAutomationRuns } from "@/actions/automation.actions";
import { toastError, toastSuccess } from "@/lib/toast";

vi.mock("@/actions/automation.actions", () => ({
  deleteAutomation: vi.fn(),
  pauseAutomation: vi.fn(),
  resumeAutomation: vi.fn(),
  getAutomationRuns: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const automation: AutomationWithResume = {
  id: "automation-1",
  userId: "user-1",
  name: "Remote data roles",
  jobBoard: "remote",
  keywords: "",
  location: "",
  sourceConfig: JSON.stringify({
    remote: { companies: [{ name: "Himalayas", token: "himalayas" }] },
  }),
  resumeId: "00000000-0000-4000-8000-000000000001",
  matchThreshold: 75,
  scheduleHour: 12,
  nextRunAt: null,
  lastRunAt: null,
  status: "active",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  resume: { id: "00000000-0000-4000-8000-000000000001", title: "Data" },
};

const run = (id: string, status: string, jobsSaved = 0) => ({
  id,
  status,
  jobsSaved,
});

function runsReturn(...sequence: unknown[][]) {
  const mock = getAutomationRuns as any;
  mock.mockReset();
  for (const data of sequence) {
    mock.mockResolvedValueOnce({ success: true, data });
  }
  // Keep answering with the last state
  mock.mockResolvedValue({ success: true, data: sequence[sequence.length - 1] });
}

function respond(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as never;
}

const originalFetch = global.fetch;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  (toastSuccess as any).mockClear();
  (toastError as any).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  global.fetch = originalFetch;
});

function setup(overrides: Partial<AutomationWithResume> = {}) {
  const onRefresh = vi.fn();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <AutomationList
      automations={[{ ...automation, ...overrides }]}
      onEdit={vi.fn()}
      onRefresh={onRefresh}
    />,
  );
  return { user, onRefresh };
}

const poll = () => act(() => vi.advanceTimersByTimeAsync(3000));

describe("AutomationList — Run now", () => {
  it("starts a run and shows it running, linked to the automation's page", async () => {
    runsReturn([run("old", "completed", 2)]);
    respond(200, { success: true, started: true });
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: /Run now/ }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/automations/automation-1/run",
      { method: "POST" },
    );
    const running = await screen.findByRole("link", { name: /Running/ });
    expect(running).toHaveAttribute("href", "/dashboard/automations/automation-1");
    expect(toastSuccess).toHaveBeenCalledWith(
      expect.any(String),
      "Running “Remote data roles”",
    );
  });

  it("reports the new run's result and refreshes the list when it finishes", async () => {
    runsReturn(
      [run("old", "completed", 2)], // before starting
      [run("old", "completed", 2)], // new run not recorded yet
      [run("new", "running")],
      [run("new", "completed", 4)],
    );
    respond(200, { success: true, started: true });
    const { user, onRefresh } = setup();

    await user.click(screen.getByRole("button", { name: /Run now/ }));
    await screen.findByRole("link", { name: /Running/ });

    // The previous run's "completed" must not be read as this run finishing
    await poll();
    await poll();
    expect(onRefresh).not.toHaveBeenCalled();

    await poll();
    expect(toastSuccess).toHaveBeenLastCalledWith(
      "Saved 4 new jobs",
      "“Remote data roles” finished",
    );
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Run now/ })).toBeEnabled();
  });

  it("says when a run finished with some boards failing", async () => {
    runsReturn([], [run("new", "completed_with_errors", 1)]);
    respond(200, { success: true, started: true });
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: /Run now/ }));
    await screen.findByRole("link", { name: /Running/ });
    await poll();

    expect(toastSuccess).toHaveBeenLastCalledWith(
      expect.stringMatching(/^Saved 1 new job\. Some job boards failed/),
      "“Remote data roles” finished with errors",
    );
  });

  it("reports a run that did not finish as an error", async () => {
    runsReturn([], [run("new", "failed")]);
    respond(200, { success: true, started: true });
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: /Run now/ }));
    await screen.findByRole("link", { name: /Running/ });
    await poll();

    expect(toastError).toHaveBeenLastCalledWith(
      expect.any(String),
      "“Remote data roles” did not finish",
    );
  });

  it("follows a run that was already in progress", async () => {
    runsReturn(
      [run("sched", "running")],
      [run("sched", "running")],
      [run("sched", "completed", 3)],
    );
    respond(409, { success: false, message: "A run is already in progress for this automation." });
    const { user, onRefresh } = setup();

    await user.click(screen.getByRole("button", { name: /Run now/ }));
    await screen.findByRole("link", { name: /Running/ });

    await poll();
    expect(onRefresh).not.toHaveBeenCalled();
    await poll();
    expect(toastSuccess).toHaveBeenLastCalledWith(
      "Saved 3 new jobs",
      "“Remote data roles” finished",
    );
  });

  it("shows the server's reason when a run cannot start", async () => {
    runsReturn([]);
    respond(429, { message: "Rate limit exceeded. Maximum 5 manual runs per hour." });
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: /Run now/ }));

    expect(toastError).toHaveBeenCalledWith(
      "Rate limit exceeded. Maximum 5 manual runs per hour.",
      "Could not run “Remote data roles”",
    );
    expect(screen.getByRole("button", { name: /Run now/ })).toBeEnabled();
    expect(screen.queryByRole("link", { name: /Running/ })).not.toBeInTheDocument();
  });

  it("is disabled for a paused automation, as on the automation's page", () => {
    setup({ status: "paused" });
    expect(screen.getByRole("button", { name: /Run now/ })).toBeDisabled();
  });

  it("reports an AI Matching run as jobs scored", async () => {
    runsReturn(
      [],
      [{ id: "new", status: "completed", jobsSaved: 0, jobsProcessed: 12, jobsMatched: 3 }],
    );
    respond(200, { success: true, started: true });
    const { user } = setup({
      jobBoard: "ai-match",
      sourceConfig: JSON.stringify({
        "ai-match": {
          maxJobs: 12,
          newestFirst: true,
          includeDiscovered: true,
          includeTracked: false,
          resumeSource: "job",
        },
      }),
    });

    // Its row describes what it scores rather than companies and titles
    expect(screen.getByText(/up to 12, newest first/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Run now/ }));
    await screen.findByRole("link", { name: /Running/ });
    await poll();

    expect(toastSuccess).toHaveBeenLastCalledWith(
      "Scored 12 jobs, 3 strong matches",
      "“Remote data roles” finished",
    );
  });

  it("is disabled when the automation's resume is missing", () => {
    setup({ resume: null as never });
    expect(screen.getByRole("button", { name: /Run now/ })).toBeDisabled();
  });
});
