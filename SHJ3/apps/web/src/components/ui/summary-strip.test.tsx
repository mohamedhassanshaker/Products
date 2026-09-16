import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { SummaryStrip, type BlockingCondition } from "./summary-strip";

describe("SummaryStrip", () => {
  it("variant=rule renders static prose with no live region", () => {
    render(<SummaryStrip variant="rule">Step-up happens before the tool call.</SummaryStrip>);
    expect(screen.getByText("Step-up happens before the tool call.")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("variant=consequence is a polite live region", () => {
    render(
      <SummaryStrip variant="consequence">3 skills attached, 2 MCP tools bound.</SummaryStrip>,
    );
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("variant=blocking names every failing condition, not only the first (RISK-007)", () => {
    const conditions: [BlockingCondition, ...BlockingCondition[]] = [
      { blocked: "Accuracy", measured: "71%", threshold: "85%", source: "B13 tab 2" },
      { blocked: "Locale", measured: "82%", threshold: "100%", source: "B10 tab 5" },
    ];
    render(
      <SummaryStrip variant="blocking" subject="General FAQ Agent v3.0" conditions={conditions} />,
    );
    expect(screen.getByText("General FAQ Agent v3.0")).toBeInTheDocument();
    expect(screen.getByText(/blocked by/)).toHaveTextContent("blocked by 2 conditions");
    expect(screen.getByText("Accuracy")).toBeInTheDocument();
    expect(screen.getByText("Locale")).toBeInTheDocument();
    expect(screen.getByText("71%")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
  });

  it("variant=blocking with a single condition uses singular wording and still renders it", () => {
    const conditions: [BlockingCondition, ...BlockingCondition[]] = [
      { blocked: "Accuracy", measured: "71%", threshold: "85%", source: "B13 tab 2" },
    ];
    render(<SummaryStrip variant="blocking" subject="Billing Agent" conditions={conditions} />);
    expect(screen.getByText(/blocked by/)).toHaveTextContent("blocked by 1 condition.");
  });

  it("recomputing sets aria-busy without hiding the previous text", () => {
    const { rerender } = render(
      <SummaryStrip variant="consequence">8,940 conversations</SummaryStrip>,
    );
    rerender(
      <SummaryStrip variant="consequence" recomputing>
        8,940 conversations
      </SummaryStrip>,
    );
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("8,940 conversations")).toBeInTheDocument();
  });

  it("errorMessage replaces the content rather than rendering a stale consequence", () => {
    render(
      <SummaryStrip variant="consequence" errorMessage="Could not compute the live count">
        stale value
      </SummaryStrip>,
    );
    expect(screen.queryByText("stale value")).not.toBeInTheDocument();
    expect(screen.getByText("Could not compute the live count")).toBeInTheDocument();
  });

  it("variant=pointer renders a real in-app link", () => {
    render(
      <SummaryStrip
        variant="pointer"
        href="/tools/resilience"
        linkLabel="Tools → Resilience & fallbacks"
      >
        SEWA bill API is degraded — its circuit breaker is configured under
      </SummaryStrip>,
    );
    const link = screen.getByRole("link", { name: "Tools → Resilience & fallbacks" });
    expect(link).toHaveAttribute("href", "/tools/resilience");
  });

  it("has zero axe violations for a blocking strip", async () => {
    const conditions: [BlockingCondition, ...BlockingCondition[]] = [
      { blocked: "Accuracy", measured: "71%", threshold: "85%", source: "B13 tab 2" },
    ];
    const { container } = render(
      <SummaryStrip variant="blocking" subject="Billing Agent" conditions={conditions} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

/**
 * RISK-007's mechanical enforcement (§11.7): a `blocking` strip's `conditions`
 * is `[BlockingCondition, ...BlockingCondition[]]`, not `BlockingCondition[]`,
 * so the empty-array case must not type-check. Never called; its only job is
 * to fail `tsc` if the `@ts-expect-error` stops being necessary.
 */
function typeLevelProofConditionsCannotBeEmpty() {
  return (
    // @ts-expect-error - conditions must be non-empty; [] must not type-check.
    <SummaryStrip variant="blocking" subject="Any agent" conditions={[]} />
  );
}
void typeLevelProofConditionsCannotBeEmpty;
