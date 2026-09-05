// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { EscalationWaitBanner } from "./EscalationWaitBanner.js";

describe("EscalationWaitBanner (A.2.11 wait indicator)", () => {
  afterEach(() => cleanup());

  it("renders a status region naming the queue and an ellipsis when no position estimate is known", () => {
    render(<EscalationWaitBanner queueName="Billing Support" />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for Billing Support…");
  });

  it("renders the queue position when a positive positionEstimate is provided", () => {
    render(<EscalationWaitBanner queueName="Billing Support" positionEstimate={3} />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for Billing Support — position 3");
  });

  it("falls back to the ellipsis when positionEstimate is 0 (not yet meaningfully ranked)", () => {
    render(<EscalationWaitBanner queueName="Billing Support" positionEstimate={0} />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for Billing Support…");
  });
});
