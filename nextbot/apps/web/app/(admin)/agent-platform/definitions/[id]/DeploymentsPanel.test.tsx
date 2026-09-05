// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock("@nextbot/ui/lib/toast", () => ({
  toast: { success: (...a: unknown[]) => toastSuccessMock(...a), error: (...a: unknown[]) => toastErrorMock(...a), info: vi.fn() },
}));

import { DeploymentsPanel } from "./DeploymentsPanel.js";

/**
 * Target Architecture Blueprint Phase 17 (BL-48, UX_GUIDELINES.md §6.8) — the
 * Deployments & Canary panel's own behavior, independent of the backend.
 *
 * Focused on the properties the UX guidance calls load-bearing rather than on markup:
 * the sum-to-100 gate, the "—" vs "0%" metric distinction, the required reason, and the
 * next-turn stickiness disclosure.
 */

const VERSIONS = [
  { id: "v-stable", version: "1.0.0", status: "Production" as const },
  { id: "v-canary", version: "1.1.0", status: "Production" as const },
  { id: "v-draft", version: "2.0.0", status: "Draft" as const },
];

function mockLoad(allocations: Array<{ id: string; agentDefinitionVersionId: string; trafficSplitPct: number }>, metrics: unknown[] = []) {
  fetchJsonMock.mockImplementation(async (url: string) => {
    if (url.includes("/deployments/history")) return { kind: "ok", data: { history: [] } };
    if (url.includes("/deployments")) return { kind: "ok", data: { allocations: allocations.map((a) => ({ ...a, activatedAt: "2026-08-31T00:00:00Z" })), metrics } };
    if (url.includes("/shadow-evaluations")) return { kind: "ok", data: { evaluations: [] } };
    return { kind: "ok", data: {} };
  });
}

describe("DeploymentsPanel (Phase 17, BL-48)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });
  afterEach(() => cleanup());

  it("renders the empty state — not an error — when the agent has no active deployment yet", async () => {
    mockLoad([]);
    render(<DeploymentsPanel definitionId="def-1" versions={VERSIONS} canWrite />);
    expect(await screen.findByText(/no active deployment yet/i)).toBeInTheDocument();
  });

  it("shows the live total and disables Save until the allocations sum to exactly 100%", async () => {
    mockLoad([
      { id: "d1", agentDefinitionVersionId: "v-stable", trafficSplitPct: 90 },
      { id: "d2", agentDefinitionVersionId: "v-canary", trafficSplitPct: 10 },
    ]);
    render(<DeploymentsPanel definitionId="def-1" versions={VERSIONS} canWrite />);

    // Loaded state sums to 100 but is unchanged, so Save stays disabled (no-op saves are
    // blocked, not merely discouraged).
    expect(await screen.findByText(/total: 100% — ready to save/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save split/i })).toBeDisabled();

    // Editing one arm of a TWO-row split auto-balances the other, so the sum-to-100 rule
    // is impossible to violate by construction in the common canary workflow.
    fireEvent.change(screen.getByLabelText(/traffic percentage for v1\.1\.0/i), { target: { value: "30" } });
    expect(screen.getByText(/total: 100% — ready to save/i)).toBeInTheDocument();
    expect((screen.getByLabelText(/traffic percentage for v1\.0\.0/i) as HTMLInputElement).value).toBe("70");
    expect(screen.getByRole("button", { name: /save split/i })).toBeEnabled();
  });

  it("surfaces a sum that is not 100% as a blocking, explained state rather than letting the admin submit it", async () => {
    mockLoad([
      { id: "d1", agentDefinitionVersionId: "v-stable", trafficSplitPct: 50 },
      { id: "d2", agentDefinitionVersionId: "v-canary", trafficSplitPct: 30 },
      { id: "d3", agentDefinitionVersionId: "v-draft", trafficSplitPct: 20 },
    ]);
    render(<DeploymentsPanel definitionId="def-1" versions={VERSIONS} canWrite />);
    // Three rows: independent inputs, no auto-balance — so a change breaks the total.
    fireEvent.change(await screen.findByLabelText(/traffic percentage for v1\.1\.0/i), { target: { value: "10" } });
    expect(screen.getByText(/total: 80% — must equal 100% to save/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save split/i })).toBeDisabled();
  });

  it('distinguishes "no data yet" from a measured zero in the metrics columns', async () => {
    mockLoad(
      [
        { id: "d1", agentDefinitionVersionId: "v-stable", trafficSplitPct: 90 },
        { id: "d2", agentDefinitionVersionId: "v-canary", trafficSplitPct: 10 },
      ],
      // The stable arm has real traffic with a genuinely clean 0% error rate; the canary
      // has no runs at all. These must NOT render identically.
      [{ agentDefinitionVersionId: "v-stable", runs: 120, errorRatePct: 0, p50Ms: 800, p95Ms: 1600, costUsd: 0.42 }],
    );
    render(<DeploymentsPanel definitionId="def-1" versions={VERSIONS} canWrite />);
    expect(await screen.findByText("120")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    // The canary row's four metric cells are all the muted no-data marker.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  it("requires a non-blank reason before a split change can be confirmed, and states the next-turn consequence", async () => {
    mockLoad([
      { id: "d1", agentDefinitionVersionId: "v-stable", trafficSplitPct: 90 },
      { id: "d2", agentDefinitionVersionId: "v-canary", trafficSplitPct: 10 },
    ]);
    render(<DeploymentsPanel definitionId="def-1" versions={VERSIONS} canWrite />);

    // The persistent caption is present without opening anything.
    expect(await screen.findByText(/changes apply to each conversation's next turn/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/traffic percentage for v1\.1\.0/i), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: /save split/i }));

    const confirm = await screen.findByRole("button", { name: /confirm split change/i });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/reason \(required\)/i), { target: { value: "Widening the canary." } });
    expect(screen.getByRole("button", { name: /confirm split change/i })).toBeEnabled();
  });

  it("PUTs the edited allocations with the typed reason and reports success", async () => {
    mockLoad([
      { id: "d1", agentDefinitionVersionId: "v-stable", trafficSplitPct: 90 },
      { id: "d2", agentDefinitionVersionId: "v-canary", trafficSplitPct: 10 },
    ]);
    render(<DeploymentsPanel definitionId="def-1" versions={VERSIONS} canWrite />);

    fireEvent.change(await screen.findByLabelText(/traffic percentage for v1\.1\.0/i), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: /save split/i }));
    fireEvent.change(await screen.findByLabelText(/reason \(required\)/i), { target: { value: "Widening to 25%." } });
    fireEvent.click(screen.getByRole("button", { name: /confirm split change/i }));

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        expect.stringContaining("/deployments"),
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            environment: "Production",
            allocations: [
              { versionId: "v-stable", trafficSplitPct: 75 },
              { versionId: "v-canary", trafficSplitPct: 25 },
            ],
            reason: "Widening to 25%.",
          }),
        }),
      ),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Traffic split updated.");
  });

  it("surfaces the server's own 409 copy verbatim rather than a paraphrase, and refetches", async () => {
    mockLoad([
      { id: "d1", agentDefinitionVersionId: "v-stable", trafficSplitPct: 90 },
      { id: "d2", agentDefinitionVersionId: "v-canary", trafficSplitPct: 10 },
    ]);
    render(<DeploymentsPanel definitionId="def-1" versions={VERSIONS} canWrite />);
    fireEvent.change(await screen.findByLabelText(/traffic percentage for v1\.1\.0/i), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: /save split/i }));
    fireEvent.change(await screen.findByLabelText(/reason \(required\)/i), { target: { value: "race" } });

    // A concurrent change by another admin is a genuinely reachable 409 even though the
    // client already gated Save on a valid local sum.
    fetchJsonMock.mockImplementationOnce(async () => ({ kind: "error", status: 409, message: "Version 2.3.0 must be promoted to Production before it can receive canary traffic." }));
    fireEvent.click(screen.getByRole("button", { name: /confirm split change/i }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("Version 2.3.0 must be promoted to Production before it can receive canary traffic."));
  });

  it("promotes a canary arm to 100% through its own required-reason dialog", async () => {
    mockLoad([
      { id: "d1", agentDefinitionVersionId: "v-stable", trafficSplitPct: 90 },
      { id: "d2", agentDefinitionVersionId: "v-canary", trafficSplitPct: 10 },
    ]);
    render(<DeploymentsPanel definitionId="def-1" versions={VERSIONS} canWrite />);

    fireEvent.click(await screen.findByRole("button", { name: /promote v1\.1\.0 to 100%/i }));
    expect(await screen.findByText(/ends the current split and sends all production traffic/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm promotion to 100%/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/reason \(required\)/i), { target: { value: "Healthy for 48h." } });
    fireEvent.click(screen.getByRole("button", { name: /confirm promotion to 100%/i }));

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        expect.stringContaining("/deployments/promote-canary"),
        expect.objectContaining({ method: "POST", body: JSON.stringify({ environment: "Production", versionId: "v-canary", reason: "Healthy for 48h." }) }),
      ),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Canary promoted to 100%.");
  });

  it("renders the rollout timeline and marks an EmergencyRollback distinctly from an ordinary action", async () => {
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url.includes("/deployments/history")) {
        return {
          kind: "ok",
          data: {
            history: [
              { id: "h2", action: "EmergencyRollback", agentDefinitionVersionId: "v-stable", fromState: null, toState: null, reason: "v1.1.0 dropped refunds", actorUserId: "u1", createdAt: "2026-08-31T02:00:00Z" },
              { id: "h1", action: "SplitChange", agentDefinitionVersionId: "v-canary", fromState: null, toState: null, reason: "10% canary", actorUserId: "u1", createdAt: "2026-08-31T01:00:00Z" },
            ],
          },
        };
      }
      if (url.includes("/deployments")) return { kind: "ok", data: { allocations: [], metrics: [] } };
      if (url.includes("/shadow-evaluations")) return { kind: "ok", data: { evaluations: [] } };
      return { kind: "ok", data: {} };
    });
    render(<DeploymentsPanel definitionId="def-1" versions={VERSIONS} canWrite />);

    // The exact `deployment_action` enum vocabulary, never paraphrased.
    expect(await screen.findByText("EmergencyRollback")).toBeInTheDocument();
    expect(screen.getByText("SplitChange")).toBeInTheDocument();
    expect(screen.getByText("v1.1.0 dropped refunds")).toBeInTheDocument();
    // ADR-0017 §2.5: an emergency rollback is never indistinguishable from an ordinary one.
    expect(screen.getByText("EmergencyRollback").closest("li")).toHaveClass("border-destructive");
  });

  it("shows a retryable inline error rather than a silently empty table when the load fails", async () => {
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url.includes("/deployments/history")) return { kind: "ok", data: { history: [] } };
      if (url.includes("/deployments")) return { kind: "error", status: 500, message: "Something went wrong. Please try again." };
      if (url.includes("/shadow-evaluations")) return { kind: "ok", data: { evaluations: [] } };
      return { kind: "ok", data: {} };
    });
    render(<DeploymentsPanel definitionId="def-1" versions={VERSIONS} canWrite />);
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /retry/i }).length).toBeGreaterThanOrEqual(1);
  });

  it("hides every mutating control for a read-only admin", async () => {
    mockLoad([
      { id: "d1", agentDefinitionVersionId: "v-stable", trafficSplitPct: 90 },
      { id: "d2", agentDefinitionVersionId: "v-canary", trafficSplitPct: 10 },
    ]);
    render(<DeploymentsPanel definitionId="def-1" versions={VERSIONS} canWrite={false} />);
    await screen.findByText(/traffic allocation/i);
    expect(screen.queryByRole("button", { name: /save split/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /promote v1\.1\.0 to 100%/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/traffic percentage for v1\.0\.0/i)).toBeDisabled();
  });
});
