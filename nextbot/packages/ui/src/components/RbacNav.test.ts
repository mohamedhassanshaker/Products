import { describe, expect, it } from "vitest";
import type { PermissionMatrix } from "@nextbot/contracts";
import { isAnyNavItemVisible, isNavItemVisible } from "./RbacNav.js";

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

describe("isNavItemVisible", () => {
  it("is visible when the matrix grants at least the required level", () => {
    expect(isNavItemVisible(matrix({ connectors: "Read" }), { module: "connectors", required: "Read" })).toBe(true);
    expect(isNavItemVisible(matrix({ connectors: "Write" }), { module: "connectors", required: "Read" })).toBe(true);
  });

  it("is hidden when the matrix grants less than the required level (fail-closed default None)", () => {
    expect(isNavItemVisible(matrix({}), { module: "connectors", required: "Read" })).toBe(false);
    expect(isNavItemVisible(matrix({ connectors: "Read" }), { module: "connectors", required: "Write" })).toBe(false);
  });
});

describe("isAnyNavItemVisible (Plan Phase 3 — collapsed 'Settings' nav entry)", () => {
  const rules = [
    { module: "security_settings", required: "Read" },
    { module: "escalations", required: "Read" },
    { module: "agent_platform", required: "Read" },
  ] as const;

  it("is visible when the matrix grants at least the required level for exactly one of the rules", () => {
    expect(isAnyNavItemVisible(matrix({ escalations: "Read" }), [...rules])).toBe(true);
  });

  it("is visible when the matrix grants access to every rule", () => {
    expect(
      isAnyNavItemVisible(matrix({ security_settings: "Write", escalations: "Read", agent_platform: "Read" }), [...rules]),
    ).toBe(true);
  });

  it("is hidden when the matrix grants none of the rules (fail-closed — never visible to a caller who can read nothing behind it)", () => {
    expect(isAnyNavItemVisible(matrix({}), [...rules])).toBe(false);
  });

  it("is hidden when the matrix grants a module below its own required level for every rule", () => {
    expect(isAnyNavItemVisible(matrix({ security_settings: "None" }), [{ module: "security_settings", required: "Write" }])).toBe(
      false,
    );
  });
});
