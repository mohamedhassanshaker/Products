// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { HealthRollupScreen } from "./HealthRollupScreen.js";

const ROWS = [
  {
    tenantId: "t1",
    tenantName: "Acme Corp",
    tenantSlug: "acme-corp",
    connectorId: "c1",
    connectorName: "Salesforce",
    status: "Degraded" as const,
    lastCheckedAt: "2026-08-19T01:00:00.000Z",
    lastCheckOk: true,
    errorRatePct: 12.5,
    recentErrorCount: 3,
    callVolume: 24,
  },
  {
    tenantId: "t2",
    tenantName: "Globex",
    tenantSlug: "globex",
    connectorId: "c2",
    connectorName: "Zendesk",
    status: "Connected" as const,
    lastCheckedAt: "2026-08-19T02:00:00.000Z",
    lastCheckOk: true,
    errorRatePct: 0,
    recentErrorCount: 0,
    callVolume: 10,
  },
  {
    tenantId: "t3",
    tenantName: "Initech",
    tenantSlug: "initech",
    connectorId: "c3",
    connectorName: "Jira",
    status: "Offline" as const,
    lastCheckedAt: null,
    lastCheckOk: null,
    errorRatePct: 0,
    recentErrorCount: 0,
    callVolume: 0,
  },
];

describe("HealthRollupScreen (Platform Manager console Phase 3, NFR-11)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => cleanup());

  it("defaults to showing only degraded/offline connectors, worst status first", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { connectors: ROWS } });
    render(<HealthRollupScreen />);

    await waitFor(() => expect(screen.getByText("Jira")).toBeInTheDocument());
    expect(screen.getByText("Salesforce")).toBeInTheDocument();
    expect(screen.queryByText("Zendesk")).not.toBeInTheDocument();

    const rows = screen.getAllByRole("row").slice(1); // drop header row
    expect(rows[0]).toHaveTextContent("Initech");
    expect(rows[0]).toHaveTextContent("Jira");
    expect(rows[1]).toHaveTextContent("Acme Corp");

    expect(screen.getByText(/2 connectors across 2 tenants need attention/i)).toBeInTheDocument();
  });

  it("shows every connector, including Connected ones, once the attention-only filter is turned off", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { connectors: ROWS } });
    render(<HealthRollupScreen />);
    await waitFor(() => expect(screen.getByText("Jira")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: /show only degraded\/offline connectors/i }));
    await waitFor(() => expect(screen.getByText("Zendesk")).toBeInTheDocument());
  });

  it("renders 'Never checked' for a connector with no recorded probes, not a crash", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { connectors: ROWS } });
    render(<HealthRollupScreen />);
    await waitFor(() => expect(screen.getByText("Jira")).toBeInTheDocument());
    expect(screen.getByText("Never checked")).toBeInTheDocument();
  });

  it("links a tenant name through to its Tenant Detail screen", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { connectors: ROWS } });
    render(<HealthRollupScreen />);
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Acme Corp" })).toHaveAttribute("href", "/internal/ops/tenants/t1");
  });

  it("shows the all-clear message when nothing needs attention", async () => {
    fetchJsonMock.mockResolvedValue({
      kind: "ok",
      data: { connectors: [ROWS[1]] },
    });
    render(<HealthRollupScreen />);
    await waitFor(() => expect(screen.getByText(/no degraded or offline connectors/i)).toBeInTheDocument());
    expect(screen.getByText(/no connectors currently need attention/i)).toBeInTheDocument();
  });

  it("surfaces a forbidden/error fetch outcome as an alert rather than silently rendering nothing", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "forbidden", message: "You don't have access to this section." });
    render(<HealthRollupScreen />);
    await waitFor(() => expect(screen.getByText("You don't have access to this section.")).toBeInTheDocument());
  });
});
