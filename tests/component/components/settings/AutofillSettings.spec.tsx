import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AutofillSettings from "@/components/settings/AutofillSettings";
import {
  createExtensionToken,
  getAutofillAnswers,
  saveAutofillAnswers,
} from "@/actions/autofill.actions";

vi.mock("@/lib/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock("@/actions/autofill.actions", () => ({
  getAutofillAnswers: vi.fn(),
  saveAutofillAnswers: vi.fn(),
  createExtensionToken: vi.fn(),
}));

describe("AutofillSettings", () => {
  beforeEach(() => {
    vi.mocked(getAutofillAnswers).mockResolvedValue([
      { id: "a1", question: "Gender", answer: "Decline to self-identify", updatedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    vi.mocked(saveAutofillAnswers).mockImplementation(async (answers) => ({ success: true, answers }));
  });

  it("edits, adds from the common list, deletes and saves answers", async () => {
    const user = userEvent.setup();
    render(<AutofillSettings />);
    expect(await screen.findByDisplayValue("Gender")).toBeInTheDocument();
    // Already answered, so not offered again
    expect(screen.queryByRole("button", { name: /^Gender$/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /What are your salary expectations/ }));
    await user.type(screen.getByLabelText("Answer 2"), "Open to discussion");
    await user.click(screen.getByRole("button", { name: "Delete answer 1" }));
    await user.click(screen.getByRole("button", { name: "Save answers" }));

    await waitFor(() => expect(saveAutofillAnswers).toHaveBeenCalled());
    const saved = vi.mocked(saveAutofillAnswers).mock.calls[0][0];
    expect(saved.map((a) => [a.question, a.answer])).toEqual([
      ["What are your salary expectations?", "Open to discussion"],
    ]);
  });

  it("creates an access token and shows it once, with the download link", async () => {
    vi.mocked(createExtensionToken).mockResolvedValue({
      success: true,
      token: "jsync_abc",
      record: {} as never,
    });
    const user = userEvent.setup();
    render(<AutofillSettings />);
    expect(screen.getByRole("link", { name: /download the extension/i })).toHaveAttribute(
      "href",
      "/extension/jobsync-autofill.xpi",
    );
    await user.click(screen.getByRole("button", { name: /create access token/i }));
    expect(await screen.findByText("jsync_abc")).toBeInTheDocument();
  });
});
