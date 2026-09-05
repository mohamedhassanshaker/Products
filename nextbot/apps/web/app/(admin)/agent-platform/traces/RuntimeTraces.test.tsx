// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { RuntimeTraces } from "./RuntimeTraces.js";

/** shadcn/Tailwind conversion (Batch D) — same `chooseOption` helper this
 * migration established in `RoutingConfig.test.tsx` (Batch A) for driving the
 * new Base UI-backed `Select` instead of a native `<select>`'s `fireEvent.change`. */
async function chooseOption(triggerName: string | RegExp, optionName: string) {
  const trigger = await screen.findByRole("combobox", { name: triggerName });
  fireEvent.click(trigger);
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.pointerDown(option);
  fireEvent.click(option);
}

describe("RuntimeTraces (BL-07 basic run list, UX_GUIDELINES.md §6.7 — not a trace viewer)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("prompts to select a definition/version before showing any runs", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { definitions: [{ id: "d1", name: "support-triage" }] } });
    render(<RuntimeTraces />);
    expect(await screen.findByText(/select an agent definition and version/i)).toBeInTheDocument();
  });

  it("shows the honest empty state (explaining why) once a version is selected with zero runs", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/runs")) return Promise.resolve({ kind: "ok", data: { runs: [] } });
      if (url.includes("/versions")) return Promise.resolve({ kind: "ok", data: { versions: [{ id: "v1", version: "1.0.0" }] } });
      if (url.includes("/definitions")) return Promise.resolve({ kind: "ok", data: { definitions: [{ id: "d1", name: "support-triage" }] } });
      return Promise.resolve({ kind: "ok", data: {} });
    });
    render(<RuntimeTraces />);
    await screen.findByRole("combobox", { name: /agent definition/i });
    await chooseOption(/agent definition/i, "support-triage");
    await chooseOption(/^version$/i, "v1.0.0");
    expect(await screen.findByText(/no agent runs recorded yet/i)).toBeInTheDocument();
  });

  it("renders a real run row with status/trigger/cost/trace id", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/runs"))
        return Promise.resolve({
          kind: "ok",
          data: { runs: [{ id: "run1", status: "Succeeded", trigger: "EvalCase", costUsd: "0.0031", durationMs: 1200, startedAt: new Date().toISOString(), otelTraceId: "a".repeat(32) }] },
        });
      if (url.includes("/versions")) return Promise.resolve({ kind: "ok", data: { versions: [{ id: "v1", version: "1.0.0" }] } });
      if (url.includes("/definitions")) return Promise.resolve({ kind: "ok", data: { definitions: [{ id: "d1", name: "support-triage" }] } });
      return Promise.resolve({ kind: "ok", data: {} });
    });
    render(<RuntimeTraces />);
    await screen.findByRole("combobox", { name: /agent definition/i });
    await chooseOption(/agent definition/i, "support-triage");
    await chooseOption(/^version$/i, "v1.0.0");
    expect(await screen.findByText("Succeeded")).toBeInTheDocument();
    expect(screen.getByText("EvalCase")).toBeInTheDocument();
    expect(screen.getByText("$0.0031")).toBeInTheDocument();
  });
});
