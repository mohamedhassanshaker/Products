import { describe, expect, it } from "vitest";
import type { PermissionMatrix } from "@nextbot/contracts";
import { ForbiddenModuleError } from "@nextbot/contracts";
import { hasAtLeast, mergePermissionMatrices, requirePermission } from "./permission-matrix.js";

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

describe("hasAtLeast", () => {
  it("None < Read < Write ordering holds", () => {
    const m = matrix({ connectors: "Read" });
    expect(hasAtLeast(m, "connectors", "None")).toBe(true);
    expect(hasAtLeast(m, "connectors", "Read")).toBe(true);
    expect(hasAtLeast(m, "connectors", "Write")).toBe(false);
  });

  it("treats a missing module key as None (fail-closed)", () => {
    const m = {} as PermissionMatrix;
    expect(hasAtLeast(m, "connectors", "Read")).toBe(false);
  });
});

describe("requirePermission", () => {
  it("does not throw when the matrix grants at least the required level", () => {
    const m = matrix({ connectors: "Write" });
    expect(() => requirePermission(m, "connectors", "Write")).not.toThrow();
  });

  it("throws ForbiddenModuleError naming the module and required level when denied", () => {
    const m = matrix({ connectors: "Read" });
    try {
      requirePermission(m, "connectors", "Write");
      expect.fail("expected requirePermission to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenModuleError);
      expect((err as ForbiddenModuleError).module).toBe("connectors");
      expect((err as ForbiddenModuleError).required).toBe("Write");
    }
  });
});

describe("mergePermissionMatrices (union of roles — highest level per module wins)", () => {
  it("takes the higher level across multiple role matrices for the same module", () => {
    const readOnly = matrix({ connectors: "Read" });
    const admin = matrix({ connectors: "Write" });
    const merged = mergePermissionMatrices([readOnly, admin]);
    expect(merged.connectors).toBe("Write");
  });

  it("does not downgrade a module a later matrix leaves at None", () => {
    const a = matrix({ escalations: "Write" });
    const b = matrix({ escalations: "None" });
    const merged = mergePermissionMatrices([a, b]);
    expect(merged.escalations).toBe("Write");
  });

  it("returns an all-None-equivalent matrix (no entries) when given no roles", () => {
    const merged = mergePermissionMatrices([]);
    expect(hasAtLeast(merged, "connectors", "Read")).toBe(false);
  });
});
