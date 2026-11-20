import { render, screen } from "@testing-library/react";
import {
  DealBreakerNotice,
  DealBreakerFlag,
} from "@/components/automations/DealBreakerNotice";

describe("DealBreakerNotice", () => {
  it("names the deal breakers found and says the job was withdrawn", () => {
    render(
      <DealBreakerNotice
        dealBreakers={{
          checked: ["occasional travel", "relocation"],
          found: ["occasional travel"],
          withdrawn: true,
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Deal breaker found");
    expect(screen.getByText("occasional travel")).toBeInTheDocument();
    expect(screen.getByText(/moved to Withdrawn/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /edit deal breakers/i })).toHaveAttribute(
      "href",
      "/dashboard/settings?section=deal-breakers",
    );
  });

  it("shows a quiet line for a clean check and nothing for no check", () => {
    const { container, rerender } = render(
      <DealBreakerNotice dealBreakers={{ checked: ["a", "b"], found: [] }} />,
    );
    expect(screen.getByText(/No deal breakers found \(2 checked\)/)).toBeInTheDocument();
    rerender(<DealBreakerNotice dealBreakers={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("DealBreakerFlag", () => {
  it("flags a row whose stored match found a deal breaker", () => {
    render(
      <DealBreakerFlag
        matchData={JSON.stringify({ dealBreakers: { checked: ["a"], found: ["a"] } })}
      />,
    );
    expect(screen.getByText("Deal breaker")).toHaveAttribute("title", "Deal breaker: a");
  });

  it("renders nothing for an old match", () => {
    const { container } = render(<DealBreakerFlag matchData={'{"matchScore":50}'} />);
    expect(container).toBeEmptyDOMElement();
  });
});
