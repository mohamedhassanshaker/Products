// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const fetchJsonMock = vi.fn();
vi.mock("../../../src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { ConnectorsList } from "./ConnectorsList.js";

describe("ConnectorsList (QA Defects U3/U4/U12)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders the full-page access-denied state on a 403, not an empty list (QA Defect U3)", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "forbidden", message: "denied" });
    render(<ConnectorsList permissionLevel="None" />);
    expect(await screen.findByText(/you don't have access to this section/i)).toBeInTheDocument();
    expect(screen.queryByText(/no connectors yet/i)).not.toBeInTheDocument();
  });

  it("renders the genuinely-empty state only on a real empty ok response", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { connectors: [] } });
    render(<ConnectorsList permissionLevel="Write" />);
    expect(await screen.findByText(/no connectors yet/i)).toBeInTheDocument();
  });

  it("disables Add Connector and Discover Tools for a Read-only caller (QA Defect U4)", async () => {
    fetchJsonMock.mockResolvedValue({
      kind: "ok",
      data: { connectors: [{ id: "c1", name: "Zendesk", backendType: "Ticketing", environment: "Sandbox", status: "Connected" }] },
    });
    render(<ConnectorsList permissionLevel="Read" />);
    await screen.findByText("Zendesk");

    expect(screen.getByRole("button", { name: "Add Connector" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discover Tools" })).toBeDisabled();
  });

  it("renders Add Connector as a working link and Discover Tools as enabled for Write", async () => {
    fetchJsonMock.mockResolvedValue({
      kind: "ok",
      data: { connectors: [{ id: "c1", name: "Zendesk", backendType: "Ticketing", environment: "Sandbox", status: "Connected" }] },
    });
    render(<ConnectorsList permissionLevel="Write" />);
    await screen.findByText("Zendesk");

    // Phase 3 (BL-34, LLD §14.3.1) — "Add Connector" now enters the 9-step wizard.
    expect(screen.getByRole("link", { name: "Add Connector" })).toHaveAttribute("href", "/mcp/servers/new");
    expect(screen.getByRole("button", { name: "Discover Tools" })).toBeEnabled();
  });

  it("shows the QA Defect U12 copy when discovery finds zero tools", async () => {
    fetchJsonMock.mockResolvedValue({
      kind: "ok",
      data: { connectors: [{ id: "c1", name: "Zendesk", backendType: "Ticketing", environment: "Sandbox", status: "Connected" }] },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ toolsAdded: 0, toolsUpdated: 0 }) }),
    );
    render(<ConnectorsList permissionLevel="Write" />);
    await screen.findByText("Zendesk");

    fireEvent.click(screen.getByRole("button", { name: "Discover Tools" }));
    expect(await screen.findByText(/reported no available tools/i)).toBeInTheDocument();
  });

  it("surfaces a normal discovery result count", async () => {
    fetchJsonMock.mockResolvedValue({
      kind: "ok",
      data: { connectors: [{ id: "c1", name: "Zendesk", backendType: "Ticketing", environment: "Sandbox", status: "Connected" }] },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ toolsAdded: 2, toolsUpdated: 1 }) }),
    );
    render(<ConnectorsList permissionLevel="Write" />);
    await screen.findByText("Zendesk");

    fireEvent.click(screen.getByRole("button", { name: "Discover Tools" }));
    expect(await screen.findByText("Discovered 2 new tool(s), updated 1.")).toBeInTheDocument();
  });

  it("surfaces the verbatim transport error on a failed discovery (FR-MCP-02)", async () => {
    fetchJsonMock.mockResolvedValue({
      kind: "ok",
      data: { connectors: [{ id: "c1", name: "Zendesk", backendType: "Ticketing", environment: "Sandbox", status: "Connected" }] },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ title: "upstream said no" }) }),
    );
    render(<ConnectorsList permissionLevel="Write" />);
    await screen.findByText("Zendesk");

    fireEvent.click(screen.getByRole("button", { name: "Discover Tools" }));
    expect(await screen.findByText("upstream said no")).toBeInTheDocument();
  });

  it("shows a loading spinner before the initial fetch resolves", () => {
    fetchJsonMock.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ConnectorsList permissionLevel="Write" />);
    expect(screen.getByLabelText(/loading connectors/i)).toBeInTheDocument();
  });

  it("waits for a real ok result before rendering forbidden/empty states, without waitFor timing out", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { connectors: [] } });
    render(<ConnectorsList permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByText(/no connectors yet/i)).toBeInTheDocument());
  });
});
