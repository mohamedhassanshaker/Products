// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock("@nextbot/ui/lib/toast", () => ({
  toast: { success: (...a: unknown[]) => toastSuccessMock(...a), error: (...a: unknown[]) => toastErrorMock(...a) },
}));

import { PlanTiersScreen } from "./PlanTiersScreen.js";

const TIERS = [
  {
    tier: "Starter",
    maxToolCallsPerSecond: 1,
    maxConcurrentConversations: 50,
    maxMcpConnectors: 3,
    isDedicatedDatabase: false,
    features: [],
    updatedAt: new Date().toISOString(),
  },
  {
    tier: "Growth",
    maxToolCallsPerSecond: 5,
    maxConcurrentConversations: 500,
    maxMcpConnectors: 15,
    isDedicatedDatabase: false,
    features: ["Priority support"],
    updatedAt: new Date().toISOString(),
  },
  {
    tier: "Enterprise",
    maxToolCallsPerSecond: 16,
    maxConcurrentConversations: 5000,
    maxMcpConnectors: null,
    isDedicatedDatabase: true,
    features: [],
    updatedAt: new Date().toISOString(),
  },
];

describe("PlanTiersScreen (Platform Manager console Phase 2, NFR-11)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });
  afterEach(() => cleanup());

  it("lists all three tiers with their quota fields and descriptive-only features copy", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { tiers: TIERS } });
    render(<PlanTiersScreen />);

    await waitFor(() => expect(screen.getByText("Starter")).toBeInTheDocument());
    expect(screen.getByText("Growth")).toBeInTheDocument();
    expect(screen.getByText("Enterprise")).toBeInTheDocument();
    expect(screen.getByText(/descriptive\/forward-looking only — it is not enforced anywhere/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Priority support")).toBeInTheDocument();
  });

  it("blocks a tier save until the confirm dialog is confirmed", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { tiers: TIERS } });
    render(<PlanTiersScreen />);
    await waitFor(() => expect(screen.getByText("Growth")).toBeInTheDocument());

    fetchJsonMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /save growth tier/i }));
    expect(await screen.findByText(/save changes to the growth tier/i)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();

    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { tier: "Growth" } });
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { tiers: TIERS } });
    fireEvent.click(screen.getByRole("button", { name: /^save tier$/i }));

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/api/internal/ops/plan-tiers/Growth",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
  });

  it("cancelling the confirm dialog performs no mutation", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { tiers: TIERS } });
    render(<PlanTiersScreen />);
    await waitFor(() => expect(screen.getByText("Starter")).toBeInTheDocument());

    fetchJsonMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /save starter tier/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("sends a blank cap field as null (no cap), not zero", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { tiers: TIERS } });
    render(<PlanTiersScreen />);
    await waitFor(() => expect(screen.getByText("Enterprise")).toBeInTheDocument());

    fetchJsonMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /save enterprise tier/i }));
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { tier: "Enterprise" } });
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { tiers: TIERS } });
    fireEvent.click(await screen.findByRole("button", { name: /^save tier$/i }));

    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalled());
    const [, init] = fetchJsonMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.maxMcpConnectors).toBeNull();
  });
});
