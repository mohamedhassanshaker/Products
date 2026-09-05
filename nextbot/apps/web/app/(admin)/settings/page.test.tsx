// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PermissionMatrix } from "@nextbot/contracts";

afterEach(() => cleanup());

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("NEXT_REDIRECT");
});
vi.mock("next/navigation", () => ({
  redirect: (...a: unknown[]) => redirectMock(...a),
}));

const getSessionMock = vi.fn();
vi.mock("@/src/lib/session", () => ({
  getSession: () => getSessionMock(),
}));

const { default: SettingsPage } = await import("./page.js");

function matrix(overrides: Partial<PermissionMatrix>): PermissionMatrix {
  return {
    channels: "None",
    connectors: "None",
    tool_permissions: "None",
    agent_tool_config: "None",
    approval_queue: "None",
    escalations: "None",
    conversations: "None",
    reporting: "None",
    a2a_config: "None",
    agent_platform: "None",
    designer: "None",
    security_settings: "None",
    audit_log: "None",
    users_roles: "None",
    developer_portal: "None",
    knowledge: "None",
    knowledge_config: "None",
    ...overrides,
  };
}

describe("app/(admin)/settings/page.tsx (Plan Phase 3 — settings hub)", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getSessionMock.mockReset();
  });

  it("renders every settings card (Branding, Users & Roles, Escalation Routing, Integrations, Audit Log, PII & Guardrails, Retention & Residency, Data Subject Requests) for a full-Write caller", async () => {
    getSessionMock.mockResolvedValue({
      permissions: matrix({
        security_settings: "Write",
        escalations: "Write",
        agent_platform: "Write",
        audit_log: "Write",
        users_roles: "Write",
      }),
    });
    render(await SettingsPage());

    for (const [name, href] of [
      ["Branding", "/settings/branding"],
      ["Users & Roles", "/roles"],
      ["Escalation Routing", "/settings/escalation-routing"],
      ["Integrations", "/settings/integrations"],
      ["Audit Log", "/audit-log"],
      ["PII & Guardrails", "/settings/pii-guardrails"],
      ["Retention & Residency", "/settings/data-policy"],
      ["Data Subject Requests", "/settings/dsr"],
      // Phase 4 (BL-36, FR-SEC-10).
      ["Single Sign-On & SCIM", "/settings/sso"],
      ["Sessions", "/settings/sessions"],
      ["Service Accounts", "/settings/service-accounts"],
    ] as const) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }

    // Neither Connector Alerts (folded into MCP Health) nor Model Gateway (stays
    // under the Agent Platform section) belongs on this hub.
    expect(screen.queryByText("Connector Alerts")).not.toBeInTheDocument();
    expect(screen.queryByText("Model Gateway")).not.toBeInTheDocument();
  });

  it("fails closed: a card for a module the caller can't read never renders, it isn't merely disabled", async () => {
    getSessionMock.mockResolvedValue({
      // Only escalations is readable — every security_settings-backed card
      // (Branding/PII/Retention/DSR), Integrations, Audit Log, and Users & Roles
      // must all be absent.
      permissions: matrix({ escalations: "Read" }),
    });
    render(await SettingsPage());

    expect(screen.getByRole("link", { name: "Escalation Routing" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Branding" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "PII & Guardrails" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Retention & Residency" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Data Subject Requests" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Integrations" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Audit Log" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Users & Roles" })).not.toBeInTheDocument();
    // Phase 4 (BL-36): SSO/SCIM and Service Accounts are `security_settings`/
    // `users_roles`-gated like the rest of this hub and must be absent too.
    expect(screen.queryByRole("link", { name: "Single Sign-On & SCIM" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Service Accounts" })).not.toBeInTheDocument();
  });

  // Phase 4 (BL-36, FR-SEC-10): "Sessions" is the one card on this hub that is
  // NEVER gated on a module grant at all — self-service session listing/
  // revocation is a right every authenticated user has, regardless of RBAC.
  it("always shows the Sessions card regardless of the caller's module permissions", async () => {
    getSessionMock.mockResolvedValue({ permissions: matrix({}) });
    render(await SettingsPage());
    expect(screen.getByRole("link", { name: "Sessions" })).toHaveAttribute("href", "/settings/sessions");
  });

  it("shows only the always-visible Sessions card (no explanatory empty state) when the caller can read none of the hub's other modules", async () => {
    getSessionMock.mockResolvedValue({ permissions: matrix({}) });
    render(await SettingsPage());
    expect(screen.queryByText(/don.t have access to any settings screens/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("redirects to /login when there is no session (defensive — layout already guards this)", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(SettingsPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });
});
