// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => cleanup());

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Both `McpHealthDashboard` (mounted in the Health tab) and `ConnectorAlertConfig`
// (mounted in the Alert Configuration tab) call `fetchJson` from their own
// `useEffect`s regardless of which tab is initially selected in some cases —
// shape every endpoint's response so neither crashes on an unrelated shape.
const fetchJsonMock = vi.fn();
fetchJsonMock.mockImplementation((url: string) => {
  if (url.includes("/api/v1/admin/mcp-health")) {
    return Promise.resolve({ kind: "ok", data: { connectors: [], breakerStatuses: {}, toolHealth: [] } });
  }
  if (url.includes("/api/v1/admin/connectors")) {
    return Promise.resolve({ kind: "ok", data: { connectors: [] } });
  }
  if (url.includes("/api/v1/admin/connector-alert-rules")) {
    return Promise.resolve({ kind: "ok", data: { rules: [] } });
  }
  return Promise.resolve({ kind: "ok", data: {} });
});
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

const getModuleAccessLevelMock = vi.fn();
vi.mock("@/src/lib/require-module-access", () => ({
  getModuleAccessLevel: (...a: unknown[]) => getModuleAccessLevelMock(...a),
}));

const { default: McpHealthPage } = await import("./page.js");

describe("app/(admin)/mcp-health/page.tsx (Plan Phase 3 — Health + Alert Configuration tabs)", () => {
  it("renders the full-page access-denied state when the caller can't read the connectors module", async () => {
    getModuleAccessLevelMock.mockResolvedValue("None");
    render(await McpHealthPage({ searchParams: Promise.resolve({}) }));
    expect(await screen.findByText(/you don't have access to this section/i)).toBeInTheDocument();
  });

  it("defaults to the Health tab when no ?tab= query param is present", async () => {
    getModuleAccessLevelMock.mockResolvedValue("Read");
    render(await McpHealthPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("tab", { name: "Health", selected: true })).toBeInTheDocument();
  });

  it("selects the Alert Configuration tab when the redirected ?tab=alerts query param is present (old /settings/connector-alerts link never dead-ends)", async () => {
    getModuleAccessLevelMock.mockResolvedValue("Read");
    render(await McpHealthPage({ searchParams: Promise.resolve({ tab: "alerts" }) }));
    expect(screen.getByRole("tab", { name: "Alert Configuration", selected: true })).toBeInTheDocument();
  });
});
