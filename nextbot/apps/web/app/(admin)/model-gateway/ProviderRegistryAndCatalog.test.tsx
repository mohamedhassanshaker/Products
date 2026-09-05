// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { ProviderRegistryAndCatalog } from "./ProviderRegistryAndCatalog.js";

describe("ProviderRegistryAndCatalog (Target Architecture Blueprint Phase 1, BL-32, ADR-0011)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  function mockLoad(providers: unknown[] = [], entries: unknown[] = []) {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/model-gateway/providers")) return Promise.resolve({ kind: "ok", data: { providers } });
      if (url.includes("/model-gateway/catalog")) return Promise.resolve({ kind: "ok", data: { entries } });
      return Promise.resolve({ kind: "ok", data: {} });
    });
  }

  it("shows an empty-state message when no providers are registered", async () => {
    mockLoad([], []);
    render(<ProviderRegistryAndCatalog canWrite={true} />);
    expect(await screen.findByText(/no providers registered yet/i)).toBeInTheDocument();
  });

  it("lists a registered provider with its type/status/scope", async () => {
    mockLoad(
      [{ id: "p1", tenantId: "t1", type: "openai-compatible", name: "My vLLM", baseUrl: "http://localhost:8000/v1", status: "Active", enabled: true, regionsServed: [], lastProbeAt: null }],
      [],
    );
    render(<ProviderRegistryAndCatalog canWrite={true} />);
    expect(await screen.findByText("My vLLM")).toBeInTheDocument();
    // The create form's own "Type" select also defaults to "openai-compatible", so
    // scope this assertion to the table cell rendered as <code>, not a generic text
    // match (which would ambiguously also match the select's current value).
    expect(screen.getByRole("cell", { name: "openai-compatible" })).toBeInTheDocument();
    expect(screen.getByText("This tenant")).toBeInTheDocument();
  });

  it("shows the platform scope for a tenant_id-null provider row", async () => {
    mockLoad([{ id: "p1", tenantId: null, type: "custom", name: "Platform provider", baseUrl: null, status: "Active", enabled: true, regionsServed: [], lastProbeAt: null }], []);
    render(<ProviderRegistryAndCatalog canWrite={true} />);
    expect(await screen.findByText("Platform")).toBeInTheDocument();
  });

  it("registering a provider posts to /api/v1/admin/model-gateway/providers", async () => {
    mockLoad([], []);
    render(<ProviderRegistryAndCatalog canWrite={true} />);
    await screen.findByText(/no providers registered yet/i);

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "My new provider" } });
    fireEvent.change(screen.getByLabelText(/base url/i), { target: { value: "http://localhost:8000/v1" } });
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { provider: {} } });
    fireEvent.click(screen.getByRole("button", { name: /register provider/i }));

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith("/api/v1/admin/model-gateway/providers", expect.objectContaining({ method: "POST" })),
    );
  });

  it("declares a manual catalog entry via the Catalog tab", async () => {
    mockLoad([{ id: "p1", tenantId: "t1", type: "custom", name: "Custom endpoint", baseUrl: "http://localhost:9/v1", status: "Active", enabled: true, regionsServed: [], lastProbeAt: null }], []);
    render(<ProviderRegistryAndCatalog canWrite={true} />);
    await screen.findByText("Custom endpoint");

    fireEvent.click(screen.getByRole("tab", { name: "Model Catalog" }));
    fireEvent.change(screen.getByLabelText(/model id/i), { target: { value: "my-model" } });
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: "My Model" } });
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { entry: {} } });
    fireEvent.click(screen.getByRole("button", { name: /declare model/i }));

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith("/api/v1/admin/model-gateway/catalog", expect.objectContaining({ method: "POST" })),
    );
  });

  it("does not render write actions/forms when canWrite is false (fail-closed permission gating)", async () => {
    mockLoad([{ id: "p1", tenantId: "t1", type: "openai-compatible", name: "Read-only view", baseUrl: null, status: "Active", enabled: true, regionsServed: [], lastProbeAt: null }], []);
    render(<ProviderRegistryAndCatalog canWrite={false} />);
    await screen.findByText("Read-only view");
    expect(screen.queryByRole("button", { name: /register provider/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^probe$/i })).not.toBeInTheDocument();
  });
});
