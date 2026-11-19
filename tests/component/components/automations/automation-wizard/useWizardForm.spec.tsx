import { act, renderHook, waitFor } from "@testing-library/react";
import { useWizardForm } from "@/components/automations/automation-wizard/useWizardForm";
import type { AutomationWithResume } from "@/models/automation.model";

vi.mock("@/actions/automation.actions", () => ({
  createAutomation: vi.fn(),
  updateAutomation: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const automation: AutomationWithResume = {
  id: "automation-1",
  userId: "user-1",
  name: "Frontend roles",
  jobBoard: "lever",
  keywords: "React",
  location: "Remote",
  sourceConfig: JSON.stringify({
    lever: { companies: [{ name: "Acme", token: "acme", host: "eu" }] },
  }),
  resumeId: "00000000-0000-4000-8000-000000000001",
  matchThreshold: 75,
  scheduleHour: 12,
  nextRunAt: null,
  lastRunAt: null,
  status: "active",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  resume: { id: "00000000-0000-4000-8000-000000000001", title: "Frontend" },
};

const props = {
  open: true,
  onOpenChange: vi.fn(),
  automations: [automation],
  onSuccess: vi.fn(),
  editAutomation: null as AutomationWithResume | null,
};

describe("useWizardForm subscriptions", () => {
  it("updates navigation and review values for field and nested company changes", async () => {
    const { result } = renderHook(() => useWizardForm(props));
    expect(result.current.canGoNext()).toBe(false);

    act(() => result.current.form.setValue("name", "Remote roles"));
    expect(result.current.canGoNext()).toBe(true);
    act(() => result.current.nextStep());
    expect(result.current.canGoNext()).toBe(false);

    act(() => {
      result.current.form.setValue("sourceConfig.greenhouse.companies", [
        { name: "Acme", token: "acme" },
      ]);
    });
    expect(result.current.canGoNext()).toBe(true);
    expect(result.current.atsConfig.companies).toEqual([{ name: "Acme", token: "acme" }]);

    act(() => result.current.form.setValue("jobBoard", "ashby"));
    expect(result.current.atsKey).toBe("ashby");
    expect(result.current.canGoNext()).toBe(false);
    act(() => {
      result.current.form.setValue("sourceConfig.ashby", {
        companies: [{ name: "Ashby Co", token: "ashby-co" }],
      });
      result.current.form.setValue("resumeId", automation.resumeId);
      result.current.form.setValue("matchThreshold", 90);
      result.current.form.setValue("scheduleHour", 16);
    });
    act(() => result.current.nextStep());
    expect(result.current.canGoNext()).toBe(true);
    expect(result.current.formValues).toMatchObject({
      name: "Remote roles", jobBoard: "ashby", resumeId: automation.resumeId,
      matchThreshold: 90, scheduleHour: 16,
    });

    act(() => result.current.handleClose());
    await waitFor(() => expect(result.current.formValues.name).toBe(""));
    expect(result.current.atsKey).toBe("greenhouse");
    expect(result.current.atsConfig.companies).toEqual([]);
    expect(result.current.step).toBe(0);
  });

  it("turns the general remote job boards on when the remote board is chosen", async () => {
    const { result } = renderHook(() => useWizardForm(props));
    act(() => result.current.form.setValue("name", "Remote roles"));
    act(() => result.current.nextStep());
    expect(result.current.canGoNext()).toBe(false);

    act(() => result.current.form.setValue("jobBoard", "remote"));

    // No company list to build: the Search step is passable straight away...
    expect(result.current.atsKey).toBe("remote");
    expect(result.current.canGoNext()).toBe(true);
    // ...and the default is written to the form, so it is what gets submitted
    await waitFor(() =>
      expect(result.current.formValues.sourceConfig?.remote?.companies).toEqual([
        { name: "Himalayas", token: "himalayas" },
        { name: "Jobicy", token: "jobicy" },
        { name: "Remote OK", token: "remoteok" },
        { name: "We Work Remotely", token: "weworkremotely" },
        { name: "Working Nomads", token: "workingnomads" },
        // Arbeitnow (Europe-focused) is left for the user to switch on
      ]),
    );
  });

  it("gives an AI Matching automation its default settings, with no company step", async () => {
    const { result } = renderHook(() => useWizardForm(props));
    act(() => result.current.form.setValue("name", "Score backlog"));
    act(() => result.current.nextStep());

    act(() => result.current.form.setValue("jobBoard", "ai-match"));

    expect(result.current.atsKey).toBe("ai-match");
    expect(result.current.canGoNext()).toBe(true);
    await waitFor(() =>
      expect(result.current.formValues.sourceConfig?.["ai-match"]).toEqual({
        maxJobs: 20,
        newestFirst: true,
        includeDiscovered: true,
        includeTracked: true,
        resumeSource: "job",
      }),
    );
  });

  it("will not move past AI Matching settings with nothing to score", () => {
    const { result } = renderHook(() => useWizardForm(props));
    act(() => result.current.form.setValue("name", "Score backlog"));
    act(() => result.current.nextStep());
    act(() => {
      result.current.form.setValue("jobBoard", "ai-match");
      result.current.form.setValue("sourceConfig", {
        "ai-match": {
          maxJobs: 20,
          newestFirst: true,
          includeDiscovered: false,
          includeTracked: false,
          resumeSource: "job",
        },
      });
    });

    expect(result.current.canGoNext()).toBe(false);
  });

  it("reloads an AI Matching automation's settings when editing it", () => {
    const editing = {
      ...automation,
      jobBoard: "ai-match",
      sourceConfig: JSON.stringify({
        "ai-match": {
          maxJobs: 75,
          newestFirst: false,
          includeDiscovered: false,
          includeTracked: true,
          resumeSource: "automation",
        },
      }),
    } as AutomationWithResume;

    const { result } = renderHook(() =>
      useWizardForm({ ...props, editAutomation: editing }),
    );

    expect(result.current.matchConfig).toEqual({
      maxJobs: 75,
      newestFirst: false,
      includeDiscovered: false,
      includeTracked: true,
      resumeSource: "automation",
    });
  });

  it("reflects edit resets and defaults when the permanently mounted wizard reopens", () => {
    const { result, rerender } = renderHook((p) => useWizardForm(p), { initialProps: props });
    rerender({ ...props, editAutomation: automation });
    expect(result.current.formValues.name).toBe("Frontend roles");
    expect(result.current.atsKey).toBe("lever");
    expect(result.current.atsConfig.companies).toEqual([
      { name: "Acme", token: "acme", host: "eu" },
    ]);

    act(() => result.current.nextStep());
    expect(result.current.step).toBe(1);
    act(() => result.current.form.setValue("name", "Unsaved"));
    rerender({ ...props, open: false, editAutomation: automation });
    rerender({ ...props, editAutomation: automation });
    expect(result.current.formValues.name).toBe("Frontend roles");
    expect(result.current.step).toBe(0);
    rerender(props);
    expect(result.current.formValues.name).toBe("");
    expect(result.current.formValues.matchThreshold).toBe(80);
  });

  it("rejects an occupied schedule hour and advances after it changes", async () => {
    const { result } = renderHook(() => useWizardForm(props));
    for (let step = 0; step < 4; step++) {
      act(() => result.current.nextStep());
    }
    act(() => result.current.form.setValue("scheduleHour", 12));
    act(() => result.current.nextStep());
    expect(result.current.step).toBe(4);
    await waitFor(() => expect(result.current.form.formState.errors.scheduleHour?.message)
      .toContain("12:00"));

    act(() => result.current.form.setValue("scheduleHour", 13));
    act(() => result.current.nextStep());
    expect(result.current.step).toBe(5);
  });
});
