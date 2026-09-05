// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock("@nextbot/ui/lib/toast", () => ({
  toast: { success: (...a: unknown[]) => toastSuccessMock(...a), error: (...a: unknown[]) => toastErrorMock(...a) },
}));

import { BreakglassOpsScreen } from "./BreakglassOpsScreen.js";

describe("BreakglassOpsScreen (Phase 20, FR-ADM-09)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });
  afterEach(() => cleanup());

  it("shows a 'no active consent grant' state and no activate form when there is none", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { activeGrant: null } });
    render(<BreakglassOpsScreen tenantId="t1" />);
    await waitFor(() => expect(screen.getByText(/no active consent grant/i)).toBeInTheDocument());
    expect(screen.queryByText("Activate access")).not.toBeInTheDocument();
  });

  it("shows the tenant's reason and an activate form when a grant is active", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/status")) return Promise.resolve({ kind: "ok", data: { activeGrant: { grantId: "g1", reason: "outage", expiresAt: new Date(Date.now() + 60000).toISOString() } } });
      return Promise.resolve({ kind: "ok", data: {} });
    });
    render(<BreakglassOpsScreen tenantId="t1" />);
    await waitFor(() => expect(screen.getByText(/tenant's stated reason: outage/i)).toBeInTheDocument());
    expect(screen.getByText("Activate access")).toBeInTheDocument();
  });

  it("activating posts the operator's reason, then loads conversations/escalations", async () => {
    fetchJsonMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes("/status")) return Promise.resolve({ kind: "ok", data: { activeGrant: { grantId: "g1", reason: "outage", expiresAt: new Date(Date.now() + 60000).toISOString() } } });
      if (url.includes("/activate") && opts?.method === "POST") return Promise.resolve({ kind: "ok", data: { grantId: "g1" } });
      if (url.includes("/conversations")) return Promise.resolve({ kind: "ok", data: { conversations: [{ id: "c1", channelType: "WebWidget", status: "Active", recognizedGoal: "billing", startedAt: new Date().toISOString() }] } });
      if (url.includes("/escalations")) return Promise.resolve({ kind: "ok", data: { escalations: [{ id: "e1", conversationId: "c1", reason: "LowConfidence", status: "Waiting", waitSeconds: 30 }] } });
      return Promise.resolve({ kind: "ok", data: {} });
    });
    render(<BreakglassOpsScreen tenantId="t1" />);
    await waitFor(() => expect(screen.getByText("Activate access")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/your diagnostic reason/i), { target: { value: "diagnosing customer complaint" } });
    fireEvent.click(screen.getByText("Activate access"));

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/api/internal/ops/tenants/t1/breakglass/activate",
        expect.objectContaining({ method: "POST", body: expect.stringContaining("diagnosing customer complaint") }),
      ),
    );
    await waitFor(() => expect(screen.getByText(/billing/)).toBeInTheDocument());
    expect(screen.getByText(/LowConfidence/)).toBeInTheDocument();
  });

  it("surfaces a forbidden activation attempt (fail-closed) via a toast, without showing diagnosis data", async () => {
    fetchJsonMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes("/status")) return Promise.resolve({ kind: "ok", data: { activeGrant: { grantId: "g1", reason: "outage", expiresAt: new Date(Date.now() + 60000).toISOString() } } });
      if (url.includes("/activate") && opts?.method === "POST") return Promise.resolve({ kind: "forbidden", message: "No active break-glass consent grant exists for this tenant." });
      return Promise.resolve({ kind: "ok", data: {} });
    });
    render(<BreakglassOpsScreen tenantId="t1" />);
    await waitFor(() => expect(screen.getByText("Activate access")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/your diagnostic reason/i), { target: { value: "r" } });
    fireEvent.click(screen.getByText("Activate access"));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("No active break-glass consent grant exists for this tenant."));
    expect(screen.queryByText("Conversations")).not.toBeInTheDocument();
  });
});
