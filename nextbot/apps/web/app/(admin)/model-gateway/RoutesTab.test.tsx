// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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

const originalFetch = global.fetch;

import { RoutesTab } from "./RoutesTab.js";

describe("RoutesTab (Target Architecture Blueprint Phase 2, BL-33, FR-AGT-20-26)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  function mockLoad(routes: unknown[] = [], providers: unknown[] = [], catalog: unknown[] = []) {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/routes/") && url.includes("/versions")) return Promise.resolve({ kind: "ok", data: { versions: [] } });
      if (url.endsWith("/model-gateway/routes")) return Promise.resolve({ kind: "ok", data: { routes } });
      if (url.includes("/model-gateway/providers")) return Promise.resolve({ kind: "ok", data: { providers } });
      if (url.includes("/model-gateway/catalog")) return Promise.resolve({ kind: "ok", data: { entries: catalog } });
      return Promise.resolve({ kind: "ok", data: {} });
    });
  }

  it("shows an empty-state message when no routes are configured yet", async () => {
    mockLoad([], [], []);
    render(<RoutesTab canWrite={true} />);
    expect(await screen.findByText(/no routes configured yet/i)).toBeInTheDocument();
  });

  it("lists an existing route with its role and current version", async () => {
    mockLoad(
      [{ id: "r1", name: "chat.primary", role: "custom", currentVersionId: "v1", status: "Active" }],
      [],
      [],
    );
    render(<RoutesTab canWrite={true} />);
    expect(await screen.findByText("chat.primary")).toBeInTheDocument();
  });

  it("creating a route posts to /api/v1/admin/model-gateway/routes", async () => {
    mockLoad([], [], []);
    render(<RoutesTab canWrite={true} />);
    await screen.findByText(/no routes configured yet/i);

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "chat.router" } });
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { route: { id: "r2", name: "chat.router", role: "custom" } } });
    fireEvent.click(screen.getByRole("button", { name: /create route/i }));

    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith("/api/v1/admin/model-gateway/routes", expect.objectContaining({ method: "POST" })));
  });

  it("surfaces a save-time validation rejection's field-scoped errors inline (FR-AGT-22 — never a silent accept)", async () => {
    mockLoad(
      [{ id: "r1", name: "chat.primary", role: "custom", currentVersionId: null, status: "Active" }],
      [{ id: "p1", type: "openai-compatible", name: "Provider A" }],
      [{ id: "c1", providerId: "p1", modelId: "m", displayName: "m" }],
    );
    render(<RoutesTab canWrite={true} />);
    await screen.findByText("chat.primary");

    fireEvent.click(screen.getByRole("button", { name: /new version/i }));
    fireEvent.click(screen.getByRole("button", { name: /add hop/i }));

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        title: "This route version cannot be saved — it failed capability/residency validation.",
        fields: [{ path: "chain[0]", code: "ROUTE_RESIDENCY_VIOLATION", message: "Hop 0's provider is outside this tenant's residency region." }],
      }),
    }) as unknown as typeof fetch;

    fireEvent.click(screen.getByRole("button", { name: /save & publish/i }));

    expect(await screen.findByText(/residency region/i)).toBeInTheDocument();
    expect(toastErrorMock).toHaveBeenCalled();
  });

  it("does not render write actions when canWrite is false (fail-closed permission gating)", async () => {
    mockLoad([{ id: "r1", name: "chat.primary", role: "custom", currentVersionId: "v1", status: "Active" }], [], []);
    render(<RoutesTab canWrite={false} />);
    await screen.findByText("chat.primary");
    expect(screen.queryByRole("button", { name: /create route/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new version/i })).not.toBeInTheDocument();
  });
});
