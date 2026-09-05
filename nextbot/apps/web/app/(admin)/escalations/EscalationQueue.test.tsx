// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

import { EscalationQueue } from "./EscalationQueue.js";

const ITEM = {
  id: "esc-1",
  conversationId: "conv-1",
  channelType: "WebWidget",
  customerIdentifier: "••••1234",
  recognizedGoal: "billing_inquiry",
  reason: "LowConfidence",
  waitSeconds: 120,
  queueId: "q1",
  queueName: "General Support",
  status: "Waiting",
  slaDueAt: null,
  slaBreached: false,
};

const PRESENCE = { state: "Available", maxConcurrent: 3, currentLoad: 0 };

/** Routes the panel's two independent GET calls (escalation list, and — when
 * `canAct` — `PresenceToggle`'s own `agent-presence/me` self-provisioning fetch,
 * Phase 13/BL-45) so both resolve regardless of which fires first. */
function routeFetchJson(items: unknown[]) {
  fetchJsonMock.mockImplementation((url: string) => {
    if (url.includes("agent-presence")) return Promise.resolve({ kind: "ok", data: PRESENCE });
    return Promise.resolve({ kind: "ok", data: { items } });
  });
}

describe("EscalationQueue (B.5.1 — Phase 16/BL-09)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    pushMock.mockReset();
    global.fetch = vi.fn();
  });
  afterEach(() => cleanup());

  it("renders the active escalation list", async () => {
    routeFetchJson([ITEM]);
    render(<EscalationQueue permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByText("Low confidence")).toBeInTheDocument());
    expect(screen.getByText("General Support")).toBeInTheDocument();
  });

  it("renders AccessDeniedState on a 403", async () => {
    fetchJsonMock.mockResolvedValueOnce({ kind: "forbidden", message: "no access" });
    render(<EscalationQueue permissionLevel="Read" />);
    await waitFor(() => expect(screen.getByText(/don.t have access|access denied/i)).toBeInTheDocument());
  });

  it("shows an empty state with zero active escalations", async () => {
    routeFetchJson([]);
    render(<EscalationQueue permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByText("No active escalations.")).toBeInTheDocument());
  });

  it("read-only users see no Take Over action", async () => {
    // `permissionLevel="Read"` never renders `PresenceToggle` (canAct === false), so
    // a single-response mock is correct here (only the escalation list is fetched).
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { items: [ITEM] } });
    render(<EscalationQueue permissionLevel="Read" />);
    await waitFor(() => expect(screen.getByText("Low confidence")).toBeInTheDocument());
    expect(screen.queryByText("Take Over")).not.toBeInTheDocument();
  });

  it("Take Over calls the claim endpoint and navigates to the takeover panel", async () => {
    routeFetchJson([ITEM]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, json: async () => ({ id: "esc-1", status: "InProgress" }) });
    render(<EscalationQueue permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByText("Take Over")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Take Over"));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/escalations/esc-1"));
    expect(global.fetch).toHaveBeenCalledWith("/api/v1/admin/escalations/esc-1/claim", { method: "POST" });
  });

  it("Target Architecture Blueprint Phase 13 (BL-45): a breached escalation shows an 'SLA breached' badge", async () => {
    routeFetchJson([{ ...ITEM, slaDueAt: "2020-01-01T00:00:00.000Z", slaBreached: true }]);
    render(<EscalationQueue permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByTestId("sla-breached-esc-1")).toBeInTheDocument());
  });
});
