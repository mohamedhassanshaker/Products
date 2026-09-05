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

import { ShadowEvaluationCard } from "./ShadowEvaluationCard.js";

/**
 * Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.5, UX_GUIDELINES.md §6.8
 * Surface 2).
 *
 * The properties asserted here are the ones the ADR makes load-bearing rather than
 * cosmetic: results must read as evidence and never as a gate; starting an experiment must
 * make its real spend and real-customer-data implications legible before it happens; and
 * the three would-be tool-call outcomes plus `Skipped(SourceGone)` must all read as
 * findings, never as failures.
 */

const VERSIONS = [
  { id: "v-prod", version: "1.0.0", status: "Production" as const },
  { id: "v-draft", version: "2.0.0", status: "Draft" as const },
  { id: "v-old", version: "0.9.0", status: "Deprecated" as const },
];

const ACTIVE_EVALUATION = {
  id: "se-1",
  candidateVersionId: "v-draft",
  environment: "Production",
  status: "Active" as const,
  samplePct: 10,
  maxRuns: 100,
  maxCostUsd: "5.0000",
  runsEnqueued: 12,
  runsCompleted: 8,
  spendUsd: "1.25000000",
  stopReason: null,
  createdAt: "2026-08-31T00:00:00Z",
};

const REPORT = {
  evaluation: ACTIVE_EVALUATION,
  completedRuns: 8,
  skippedRuns: 1,
  failedRuns: 0,
  replyDivergencePct: 37.5,
  toolCallDivergencePct: 12.5,
  escalationRatePct: 0,
  p50Ms: 900,
  p95Ms: 2100,
  totalCostUsd: 1.25,
};


/** Base UI's `Select` is a listbox, not a native form control, and its `Select.Item`
 *  only commits a mouse-originated selection when it saw a real `pointerdown`
 *  immediately before the `click` — the same helper `ConnectorWizard.test.tsx` and
 *  `TakeoverPanel.test.tsx` already use. */
async function chooseOption(triggerName: string | RegExp, optionName: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerName }));
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.pointerDown(option);
  fireEvent.click(option);
}

function mock({ evaluations = [] as unknown[], report = null as unknown, runs = [] as unknown[] } = {}) {
  fetchJsonMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/runs")) return { kind: "ok", data: { runs } };
    if (/\/shadow-evaluations\/[^/]+$/.test(url)) return report ? { kind: "ok", data: report } : { kind: "error", status: 404, message: "not found" };
    if (url.endsWith("/shadow-evaluations")) return { kind: "ok", data: { evaluations } };
    return { kind: "ok", data: {} };
  });
}

describe("ShadowEvaluationCard (Phase 17, BL-48)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });
  afterEach(() => cleanup());

  it("always shows the 'evidence only' caption and never a promote-shaped control", async () => {
    mock({ evaluations: [ACTIVE_EVALUATION], report: REPORT });
    render(<ShadowEvaluationCard definitionId="def-1" versions={VERSIONS} canWrite />);

    expect(await screen.findByText(/evidence only — does not affect what's deployed/i)).toBeInTheDocument();
    expect(await screen.findByText(/promotion happens from the versions tab/i)).toBeInTheDocument();
    // Nothing on this card may adopt, apply or promote the candidate.
    expect(screen.queryByRole("button", { name: /promote|apply|adopt|deploy/i })).not.toBeInTheDocument();
  });

  it("renders the default state for an agent that has never run one — not an error", async () => {
    mock({});
    render(<ShadowEvaluationCard definitionId="def-1" versions={VERSIONS} canWrite />);
    expect(await screen.findByText(/no shadow evaluation has been run/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start shadow evaluation/i })).toBeInTheDocument();
  });

  it("shows live spend and run counters against their ceilings while an experiment is active", async () => {
    mock({ evaluations: [ACTIVE_EVALUATION], report: REPORT });
    render(<ShadowEvaluationCard definitionId="def-1" versions={VERSIONS} canWrite />);

    expect(await screen.findByText(/\$1\.2500 of \$5\.00 spent/i)).toBeInTheDocument();
    expect(screen.getByText(/8 of 100 runs/i)).toBeInTheDocument();
    // The queue-depth caption exists so "no results yet" reads as a queue fact, not a stall.
    expect(screen.getByText(/4 enqueued, not yet completed/i)).toBeInTheDocument();
  });

  it("offers EVERY non-deprecated version as a candidate, including a Draft — the opposite of the canary rule", async () => {
    mock({});
    render(<ShadowEvaluationCard definitionId="def-1" versions={VERSIONS} canWrite />);
    fireEvent.click(await screen.findByRole("button", { name: /start shadow evaluation/i }));

    fireEvent.click(screen.getByRole("combobox", { name: /candidate version/i }));
    expect(await screen.findByRole("option", { name: /v2\.0\.0 — Draft/i })).toBeEnabled();
    expect(screen.getByRole("option", { name: /v1\.0\.0 — Production/i })).toBeEnabled();
    // Deprecated versions are the one exclusion.
    expect(screen.queryByRole("option", { name: /v0\.9\.0/i })).not.toBeInTheDocument();
  });

  it("blocks Start until a candidate and all three ceilings are valid", async () => {
    mock({});
    render(<ShadowEvaluationCard definitionId="def-1" versions={VERSIONS} canWrite />);
    fireEvent.click(await screen.findByRole("button", { name: /start shadow evaluation/i }));

    const start = screen.getByRole("button", { name: "Start" });
    expect(start).toBeDisabled();
    expect(screen.getByText(/choose a candidate version, a sample percentage between 1 and 100/i)).toBeInTheDocument();

    await chooseOption(/candidate version/i, /v2\.0\.0 — Draft/i);
    fireEvent.change(screen.getByLabelText(/sample %/i), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/max runs/i), { target: { value: "100" } });
    // A zero cost ceiling is not a ceiling.
    fireEvent.change(screen.getByLabelText(/max cost/i), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/max cost/i), { target: { value: "5" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Start" })).toBeEnabled());
  });

  it("makes the real spend and the real-customer-data implication legible in the confirm step", async () => {
    mock({});
    render(<ShadowEvaluationCard definitionId="def-1" versions={VERSIONS} canWrite />);
    fireEvent.click(await screen.findByRole("button", { name: /start shadow evaluation/i }));
    await chooseOption(/candidate version/i, /v2\.0\.0 — Draft/i);
    fireEvent.change(screen.getByLabelText(/sample %/i), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/max runs/i), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(/max cost/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(await screen.findByText(/resends a sample of real customer conversations/i)).toBeInTheDocument();
    expect(screen.getByText(/genuine model-provider spend/i)).toBeInTheDocument();
    expect(screen.getByText(/does not shorten or skip the promotion gate/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^start shadow evaluation$/i }));
    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        expect.stringContaining("/shadow-evaluations"),
        expect.objectContaining({ method: "POST", body: JSON.stringify({ environment: "Production", candidateVersionId: "v-draft", samplePct: 10, maxRuns: 100, maxCostUsd: 5 }) }),
      ),
    );
  });

  it("renders the three would-be tool-call outcomes as distinct, non-alarming findings", async () => {
    mock({
      evaluations: [ACTIVE_EVALUATION],
      report: REPORT,
      runs: [
        {
          id: "r1",
          status: "Completed",
          skipReason: null,
          durationMs: 900,
          costUsd: "0.001",
          replyText: "hi",
          replyPayloadHash: "abc",
          liveReplyPayloadHash: "def",
          wouldHaveToolCalls: [
            { toolName: "get_order", argsMasked: {}, tier: "Tier1", outcome: "Executed(shadow-noop)" },
            { toolName: "issue_refund", argsMasked: {}, tier: "Tier3", outcome: "ShadowSuppressed" },
            { toolName: "delete_account", argsMasked: {}, tier: null, outcome: "PolicyDenied" },
          ],
          escalationSignal: null,
          guardrailOutcome: null,
          shadowAgentRunId: "run-1",
          createdAt: "2026-08-31T00:00:00Z",
        },
      ],
    });
    render(<ShadowEvaluationCard definitionId="def-1" versions={VERSIONS} canWrite />);
    fireEvent.click(await screen.findByRole("button", { name: /view runs/i }));

    expect(await screen.findByText(/would have executed \(no-op\)/i)).toBeInTheDocument();
    // The finding a reviewer opened this screen for — phrased as a finding, not an error.
    expect(screen.getByText(/would have required Tier3 approval/i)).toBeInTheDocument();
    expect(screen.getByText(/would have been denied by policy/i)).toBeInTheDocument();
    expect(screen.getByText(/differs from live/i)).toBeInTheDocument();
  });

  it("renders a purged-source skip as a normal outcome, never as a failure", async () => {
    mock({
      evaluations: [ACTIVE_EVALUATION],
      report: REPORT,
      runs: [
        {
          id: "r2",
          status: "Skipped",
          skipReason: "SourceGone",
          durationMs: null,
          costUsd: null,
          replyText: null,
          replyPayloadHash: null,
          liveReplyPayloadHash: null,
          wouldHaveToolCalls: null,
          escalationSignal: null,
          guardrailOutcome: null,
          shadowAgentRunId: null,
          createdAt: "2026-08-31T00:00:00Z",
        },
      ],
    });
    render(<ShadowEvaluationCard definitionId="def-1" versions={VERSIONS} canWrite />);
    fireEvent.click(await screen.findByRole("button", { name: /view runs/i }));

    expect(await screen.findByText(/skipped — source conversation no longer available/i)).toBeInTheDocument();
    // "Failed" appears exactly once — as the aggregate stat's LABEL, never as this run's
    // own status badge. A purged source conversation is retention policy doing its job.
    expect(screen.getAllByText("Failed")).toHaveLength(1);
    // "Skipped" appears twice — once as the aggregate stat's label, once as this run's
    // own neutral status badge; neither is the destructive "Failed" treatment.
    expect(screen.getAllByText("Skipped")).toHaveLength(2);
  });

  it("requires a non-blank reason to stop, and explains what stopping does to in-flight replays", async () => {
    mock({ evaluations: [ACTIVE_EVALUATION], report: REPORT });
    render(<ShadowEvaluationCard definitionId="def-1" versions={VERSIONS} canWrite />);
    fireEvent.click(await screen.findByRole("button", { name: /stop…/i }));

    expect(await screen.findByText(/in-flight replays already claimed by the worker will finish/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm stop/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/reason \(required\)/i), { target: { value: "Seen enough." } });
    expect(screen.getByRole("button", { name: /confirm stop/i })).toBeEnabled();
  });

  it("shows an auto-stopped experiment's own stop reason verbatim", async () => {
    const autoStopped = { ...ACTIVE_EVALUATION, status: "AutoStopped" as const, stopReason: "Reached the configured max runs or max cost ceiling." };
    mock({ evaluations: [autoStopped], report: { ...REPORT, evaluation: autoStopped } });
    render(<ShadowEvaluationCard definitionId="def-1" versions={VERSIONS} canWrite />);

    expect(await screen.findByText("Auto-stopped")).toBeInTheDocument();
    expect(screen.getByText(/reached the configured max runs or max cost ceiling/i)).toBeInTheDocument();
    // A stopped experiment offers a fresh start, not a Stop.
    expect(screen.queryByRole("button", { name: /stop…/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start shadow evaluation/i })).toBeInTheDocument();
  });

  it("offers no mutating control at all to a read-only admin", async () => {
    mock({ evaluations: [ACTIVE_EVALUATION], report: REPORT });
    render(<ShadowEvaluationCard definitionId="def-1" versions={VERSIONS} canWrite={false} />);
    await screen.findByText(/evidence only/i);
    expect(screen.queryByRole("button", { name: /start shadow evaluation/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /stop…/i })).not.toBeInTheDocument();
    // Reading the evidence is still allowed.
    expect(screen.getByRole("button", { name: /view runs/i })).toBeInTheDocument();
  });
});
