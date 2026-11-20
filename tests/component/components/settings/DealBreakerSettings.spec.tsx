import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DealBreakerSettings from "@/components/settings/DealBreakerSettings";
import {
  getUserSettings,
  updateDealBreakerSettings,
} from "@/actions/userSettings.actions";

vi.mock("@/lib/toast", () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/actions/userSettings.actions", () => ({
  getUserSettings: vi.fn(),
  updateDealBreakerSettings: vi.fn(),
}));

describe("DealBreakerSettings", () => {
  beforeEach(() => {
    vi.mocked(getUserSettings).mockResolvedValue({
      success: true,
      data: { settings: { dealBreakers: { items: ["occasional travel"], withdraw: true } } },
    });
    vi.mocked(updateDealBreakerSettings).mockImplementation(async (v) => ({
      success: true,
      data: { settings: { dealBreakers: v } },
    }));
  });

  it("shows the saved list and adds, removes and saves phrases", async () => {
    const user = userEvent.setup();
    render(<DealBreakerSettings />);
    expect(await screen.findByText("occasional travel")).toBeInTheDocument();

    await user.type(
      screen.getByLabelText("Add a deal breaker"),
      "must be willing to relocate{Enter}",
    );
    expect(screen.getByText("must be willing to relocate")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove occasional travel" }));
    await user.click(screen.getByRole("switch"));
    await user.click(screen.getByRole("button", { name: /save deal breakers/i }));

    await waitFor(() =>
      expect(updateDealBreakerSettings).toHaveBeenCalledWith({
        items: ["must be willing to relocate"],
        withdraw: false,
      }),
    );
  });

  it("counts a phrase still in the box when saving", async () => {
    const user = userEvent.setup();
    render(<DealBreakerSettings />);
    await screen.findByText("occasional travel");
    await user.type(screen.getByLabelText("Add a deal breaker"), "on-call rotation");
    await user.click(screen.getByRole("button", { name: /save deal breakers/i }));
    await waitFor(() =>
      expect(updateDealBreakerSettings).toHaveBeenCalledWith({
        items: ["occasional travel", "on-call rotation"],
        withdraw: true,
      }),
    );
  });
});
