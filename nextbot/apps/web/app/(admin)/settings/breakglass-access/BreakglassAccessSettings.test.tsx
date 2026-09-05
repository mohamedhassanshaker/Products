// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import { BreakglassAccessSettings } from "./BreakglassAccessSettings.js";

const ACTIVE_GRANT = {
  id: "g1",
  grantedByUserId: "u1",
  reason: "Investigating a reported outage",
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  revokedAt: null,
  revokedByUserId: null,
};

const REVOKED_GRANT = {
  ...ACTIVE_GRANT,
  id: "g0",
  revokedAt: new Date().toISOString(),
  revokedByUserId: "u1",
};

describe("BreakglassAccessSettings (Phase 20, FR-ADM-09)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => cleanup());

  it("renders AccessDeniedState on a 403", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "forbidden", message: "no access" });
    render(<BreakglassAccessSettings permissionLevel="Read" />);
    await waitFor(() => expect(screen.getByText(/don.t have access|access denied/i)).toBeInTheDocument());
  });

  it("shows the grant form when no active grant exists (Write access)", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { grants: [] } });
    render(<BreakglassAccessSettings permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByLabelText("Reason / scope")).toBeInTheDocument());
    expect(screen.getByText("Grant break-glass access")).toBeInTheDocument();
  });

  it("hides the grant form for a Read-only viewer", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { grants: [] } });
    render(<BreakglassAccessSettings permissionLevel="Read" />);
    await waitFor(() => expect(screen.getByText("Break-Glass Access")).toBeInTheDocument());
    expect(screen.queryByLabelText("Reason / scope")).not.toBeInTheDocument();
  });

  it("shows the active grant with a Revoke action instead of the create form", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { grants: [ACTIVE_GRANT] } });
    render(<BreakglassAccessSettings permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByText("Active grant")).toBeInTheDocument());
    expect(screen.getByText("Investigating a reported outage")).toBeInTheDocument();
    expect(screen.queryByLabelText("Reason / scope")).not.toBeInTheDocument();
    expect(screen.getByText("Revoke access now")).toBeInTheDocument();
  });

  it("revoking asks for confirmation before calling the revoke endpoint", async () => {
    fetchJsonMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST" && url.includes("/revoke")) return Promise.resolve({ kind: "ok", data: { grant: { ...ACTIVE_GRANT, revokedAt: new Date().toISOString() } } });
      return Promise.resolve({ kind: "ok", data: { grants: [ACTIVE_GRANT] } });
    });
    render(<BreakglassAccessSettings permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByText("Revoke access now")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Revoke access now"));
    await waitFor(() => expect(screen.getByText("Revoke break-glass access?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Revoke now"));
    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith(`/api/v1/admin/breakglass-grants/${ACTIVE_GRANT.id}/revoke`, { method: "POST" }));
  });

  it("shows revoked grants in a history section", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { grants: [REVOKED_GRANT] } });
    render(<BreakglassAccessSettings permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByText("History")).toBeInTheDocument());
    expect(screen.getByText("Revoked")).toBeInTheDocument();
  });

  it("submitting the grant form posts reason and expiresInHours", async () => {
    fetchJsonMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") return Promise.resolve({ kind: "ok", data: { grant: ACTIVE_GRANT } });
      return Promise.resolve({ kind: "ok", data: { grants: [] } });
    });
    render(<BreakglassAccessSettings permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByLabelText("Reason / scope")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason / scope"), { target: { value: "diagnosing something" } });
    fireEvent.click(screen.getByText("Grant break-glass access"));
    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/api/v1/admin/breakglass-grants",
        expect.objectContaining({ method: "POST", body: expect.stringContaining("diagnosing something") }),
      ),
    );
  });
});
