// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

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

import { McpHealthDashboard } from "./McpHealthDashboard.js";

const CONNECTORS = [
  {
    connector: { id: "c1", name: "Zendesk", status: "Connected", environment: "Production" },
    health: { callVolume: 120, errorRatePct: 1.2, p50LatencyMs: 80, p95LatencyMs: 300, p99LatencyMs: 500 },
    uptime30dPct: 99.9,
  },
];

const TOOL_HEALTH = [
  {
    toolId: "t1",
    toolName: "get_ticket",
    connectorId: "c1",
    callVolume: 40,
    errorRatePct: 5,
    lastErrorMessage: "Timeout",
    sparkline: [{ hour: "0", calls: 4, failures: 0 }],
    uptime30dPct: 99.5,
  },
];

const BREAKERS = { t1: { state: "Open" as const, consecutiveFailures: 5, openedAt: new Date().toISOString() } };

function mockLoad(overrides: Partial<{ connectors: unknown[]; breakerStatuses: unknown; toolHealth: unknown[] }> = {}) {
  fetchJsonMock.mockImplementation((url: string) => {
    if (url.includes("/mcp-health") && !url.includes("reset-breaker")) {
      return Promise.resolve({
        kind: "ok",
        data: {
          connectors: overrides.connectors ?? CONNECTORS,
          breakerStatuses: overrides.breakerStatuses ?? BREAKERS,
          toolHealth: overrides.toolHealth ?? TOOL_HEALTH,
        },
      });
    }
    return Promise.resolve({ kind: "ok", data: {} });
  });
}

describe("McpHealthDashboard (B.3A.4 — server status grid, tool-level health, circuit-breaker Reset)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the full-page access-denied state on a 403", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "forbidden", message: "denied" });
    render(<McpHealthDashboard permissionLevel="None" />);
    expect(await screen.findByText(/you don't have access to this section/i)).toBeInTheDocument();
  });

  it("renders the server status grid with a click-through link to the connector detail page", async () => {
    mockLoad();
    render(<McpHealthDashboard permissionLevel="Write" />);
    // "Zendesk" legitimately renders twice — once in the server status grid, once
    // more in the tool-level health table via the resolved-connector-name lookup
    // (this fixture's one tool belongs to the same connector) — so this assertion
    // uses `findAllByRole`/`getAllByRole`, not a single-match `findByText`.
    const links = await screen.findAllByRole("link", { name: "Zendesk" });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute("href", "/connectors/c1");
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("renders the tool-level health table with the resolved connector name (not a raw UUID)", async () => {
    mockLoad();
    render(<McpHealthDashboard permissionLevel="Write" />);
    expect(await screen.findByText("get_ticket")).toBeInTheDocument();
    // Resolved via the connector-name lookup built from the status grid's own rows,
    // not the raw `c1` connector id.
    expect(screen.getAllByRole("link", { name: "Zendesk" })).toHaveLength(2);
  });

  it("shows the Open breaker state and a working Reset action for a Write caller", async () => {
    mockLoad();
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("reset-breaker")) return Promise.resolve({ kind: "ok", data: {} });
      return Promise.resolve({
        kind: "ok",
        data: { connectors: CONNECTORS, breakerStatuses: BREAKERS, toolHealth: TOOL_HEALTH },
      });
    });
    render(<McpHealthDashboard permissionLevel="Write" />);
    expect(await screen.findByText("Open")).toBeInTheDocument();
    const resetButton = screen.getByRole("button", { name: "Reset" });
    fireEvent.click(resetButton);
    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/api/v1/admin/mcp-health/reset-breaker",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ toolId: "t1" }) }),
      ),
    );
    // The dashboard reloads after a successful reset.
    await waitFor(() => expect(fetchJsonMock.mock.calls.filter(([url]) => url === "/api/v1/admin/mcp-health").length).toBeGreaterThan(1));
  });

  it("hides the Reset action for a Read-only caller", async () => {
    mockLoad();
    render(<McpHealthDashboard permissionLevel="Read" />);
    await screen.findByText("Open");
    expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
  });

  it("shows the implicitly-Closed empty state when no breaker has recorded an event", async () => {
    mockLoad({ breakerStatuses: {} });
    render(<McpHealthDashboard permissionLevel="Write" />);
    expect(await screen.findByText(/every tool is implicitly closed/i)).toBeInTheDocument();
  });

  it("toggles the tool-health sort-by-error-rate control", async () => {
    mockLoad();
    render(<McpHealthDashboard permissionLevel="Write" />);
    await screen.findByText("get_ticket");
    const sortButton = screen.getByRole("button", { name: /sorted by error rate/i });
    fireEvent.click(sortButton);
    expect(screen.getByRole("button", { name: /^sort by error rate$/i })).toBeInTheDocument();
  });
});
