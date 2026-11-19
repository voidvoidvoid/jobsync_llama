import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepAiMatch } from "@/components/automations/automation-wizard/StepAiMatch";
import { AI_MATCH_DEFAULTS, type AiMatchConfig } from "@/models/automation.model";

const countUnmatchedJobs = vi.fn();
vi.mock("@/actions/automation.actions", () => ({
  countUnmatchedJobs: (scope: unknown) => countUnmatchedJobs(scope),
}));

function setup(value: Partial<AiMatchConfig> = {}) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<StepAiMatch value={{ ...AI_MATCH_DEFAULTS, ...value }} onChange={onChange} />);
  return { user, onChange };
}

beforeEach(() => {
  countUnmatchedJobs.mockReset();
  countUnmatchedJobs.mockResolvedValue({ success: true, count: 42 });
});

describe("StepAiMatch", () => {
  it("shows the defaults: both kinds, newest first, 20 a run, each job's own resume", () => {
    setup();
    expect(screen.getByRole("switch", { name: "Listings from search automations" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Jobs in My Jobs with no score" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Newest jobs first" })).toBeChecked();
    expect(screen.getByLabelText("Jobs to score per run")).toHaveValue(20);
    expect(screen.getByRole("radio", { name: /Each job's own resume/ })).toBeChecked();
  });

  it("says how many jobs are unmatched right now for the chosen kinds", async () => {
    setup({ includeTracked: false });
    expect(await screen.findByTestId("aimatch-count")).toHaveTextContent(
      "42 jobs unmatched right now",
    );
    expect(countUnmatchedJobs).toHaveBeenCalledWith({
      includeDiscovered: true,
      includeTracked: false,
    });
  });

  it("saves the number of jobs per run, capped at 200", async () => {
    const { user, onChange } = setup();
    const input = screen.getByLabelText("Jobs to score per run");

    await user.clear(input);
    await user.type(input, "500");

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxJobs: 200 }),
    );
  });

  it("ignores a cleared or zero number until a valid one is typed", async () => {
    const { user, onChange } = setup();
    const input = screen.getByLabelText("Jobs to score per run");

    await user.clear(input);
    await user.type(input, "0");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("switches to oldest first", async () => {
    const { user, onChange } = setup();
    await user.click(screen.getByRole("switch", { name: "Newest jobs first" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ newestFirst: false }),
    );
  });

  it("can use the automation's resume for every job", async () => {
    const { user, onChange } = setup();
    await user.click(screen.getByRole("radio", { name: /Always the resume/ }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ resumeSource: "automation" }),
    );
  });

  it("asks for at least one kind of job", async () => {
    setup({ includeDiscovered: false, includeTracked: false });
    expect(
      screen.getByText("Choose at least one kind of job to score."),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("aimatch-count")).toBeNull());
  });
});
