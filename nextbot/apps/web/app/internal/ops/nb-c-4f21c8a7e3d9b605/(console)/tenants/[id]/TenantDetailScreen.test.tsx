// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Target Architecture Blueprint Phase 20 (BL-52) added a `NextLink` to this screen —
// mocked exactly like every other ops console screen that uses one (`TenantListScreen.test.tsx`,
// `HealthRollupScreen.test.tsx`).
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock("@nextbot/ui/lib/toast", () => ({
  toast: { success: (...a: unknown[]) => toastSuccessMock(...a), error: (...a: unknown[]) => toastErrorMock(...a) },
}));

import { TenantDetailScreen } from "./TenantDetailScreen.js";

const SUMMARY = {
  id: "t1",
  name: "Beta Co",
  slug: "beta-co",
  region: "EU",
  status: "Active",
  planTier: "Growth",
  defaultLanguage: "en",
  createdAt: new Date().toISOString(),
  isDedicatedDatabase: false,
  dataPolicy: {
    retentionTranscriptsDays: 365,
    retentionToolPayloadsDays: 90,
    retentionToolMetadataDays: 365,
    retentionPiiDays: 30,
    residencyRegion: "EU",
  },
  runtimeQuota: {
    maxConcurrentRuns: 10,
    maxTokensPerMinute: null,
    maxToolCallsPerSecond: 5,
    maxConcurrentConversations: 500,
    maxMcpConnectors: 15,
  },
  liveConcurrentRuns: 2,
};

describe("TenantDetailScreen (NFR-11 Platform Manager console)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the tenant's overview, quota, and retention sections", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: SUMMARY });
    render(<TenantDetailScreen tenantId="t1" />);

    await waitFor(() => expect(screen.getByText("Beta Co")).toBeInTheDocument());
    expect(screen.getByText("beta-co")).toBeInTheDocument();
    expect(screen.getByText(/2 \/ 10/)).toBeInTheDocument();
    expect(screen.queryByText("Indefinite")).not.toBeInTheDocument(); // -1 not present here
    expect(screen.getAllByText("365 days").length).toBeGreaterThan(0);
  });

  it("renders a not-found message for a 404", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "error", status: 404, message: "Tenant not found." });
    render(<TenantDetailScreen tenantId="missing" />);
    expect(await screen.findByText(/no tenant found/i)).toBeInTheDocument();
  });

  it("renders a generic error alert for a non-404 failure", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "error", status: 500, message: "Something went wrong." });
    render(<TenantDetailScreen tenantId="t1" />);
    expect(await screen.findByText("Something went wrong.")).toBeInTheDocument();
  });

  it("blocks the status mutation until the confirm dialog is confirmed", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: SUMMARY });
    render(<TenantDetailScreen tenantId="t1" />);
    await waitFor(() => expect(screen.getByText("Beta Co")).toBeInTheDocument());

    fetchJsonMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /change status/i }));
    expect(await screen.findByText(/change tenant status to/i)).toBeInTheDocument();
    // The mutation must not have fired merely from opening the dialog.
    expect(fetchJsonMock).not.toHaveBeenCalled();

    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { id: "t1", status: "Active" } });
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: SUMMARY });
    fireEvent.click(screen.getByRole("button", { name: /confirm status change/i }));

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/api/internal/ops/tenants/t1/status",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
  });

  it("cancelling the status confirm dialog performs no mutation", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: SUMMARY });
    render(<TenantDetailScreen tenantId="t1" />);
    await waitFor(() => expect(screen.getByText("Beta Co")).toBeInTheDocument());

    fetchJsonMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /change status/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("blocks the plan-tier mutation until the confirm dialog is confirmed, with copy stating quota is unaffected", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: SUMMARY });
    render(<TenantDetailScreen tenantId="t1" />);
    await waitFor(() => expect(screen.getByText("Beta Co")).toBeInTheDocument());

    fetchJsonMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /change plan tier/i }));
    expect(await screen.findByText(/will not change this tenant's current quota numbers/i)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();

    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { id: "t1", planTier: "Growth" } });
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: SUMMARY });
    fireEvent.click(screen.getByRole("button", { name: /confirm plan tier change/i }));

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/api/internal/ops/tenants/t1/plan-tier",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
  });

  it("re-seed quota confirm dialog states this overwrites the current quota, and only mutates once confirmed", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: SUMMARY });
    render(<TenantDetailScreen tenantId="t1" />);
    await waitFor(() => expect(screen.getByText("Beta Co")).toBeInTheDocument());

    fetchJsonMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /re-seed quota from tier defaults/i }));
    expect(await screen.findByText(/will overwrite/i)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();

    fetchJsonMock.mockResolvedValueOnce({
      kind: "ok",
      data: { tenantId: "t1", maxToolCallsPerSecond: 5, maxConcurrentConversations: 500, maxMcpConnectors: 15 },
    });
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: SUMMARY });
    fireEvent.click(screen.getByRole("button", { name: /overwrite quota/i }));

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/api/internal/ops/tenants/t1/plan-tier/reseed-quota",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
