// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useWidgetStore } from "../../store.js";
import { ErrorBubble } from "./ErrorBubble.js";
// Source the verbatim FR-AI-05 copy from the real backend generators rather than a
// hand-typed fixture string, so this test actually verifies the backend->widget seam
// (a hardcoded fixture could match the spec by coincidence while the backend drifted).
import { backendTimeoutFallback, toolCallFailureFallback } from "@nextbot/orchestration";

describe("ErrorBubble (A.2.15 / FR-AI-05 — verbatim fallback copy)", () => {
  beforeEach(() => {
    useWidgetStore.setState({ send: vi.fn().mockResolvedValue(undefined) });
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the exact backend-timeout copy with a warning glyph", () => {
    const payload = backendTimeoutFallback();
    // Guard against the exact spec copy silently drifting in the backend generator.
    expect(payload.text).toBe(
      "I'm having trouble reaching the system right now. Please try again in a moment, or I can connect you to an agent.",
    );
    render(<ErrorBubble payload={payload} />);
    expect(screen.getByText(payload.text)).toBeInTheDocument();
    expect(screen.getByLabelText("Warning")).toBeInTheDocument();
  });

  it("renders offered chips (e.g. Try again / Talk to a human) when present", () => {
    const fallback = toolCallFailureFallback();
    expect(fallback.text).toBe(
      "Something went wrong while processing your request. I've logged this — would you like to try again or speak with an agent?",
    );
    render(
      <ErrorBubble
        payload={{
          ...fallback,
          chips: [
            { id: "retry", label: "Try again" },
            { id: "human", label: "Talk to a human" },
          ],
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Talk to a human" })).toBeInTheDocument();
  });
});
