import { describe, expect, it } from "vitest";
import { ApiKeyScopeExceedsAccountError } from "@nextbot/contracts";
import type { PermissionMatrix } from "@nextbot/contracts";
import { assertScopeWithinAccountMatrix, intersectMatrices } from "./permission-scope.js";

function matrix(overrides: Partial<PermissionMatrix>): PermissionMatrix {
  const base = Object.fromEntries(
    [
      "channels",
      "connectors",
      "tool_permissions",
      "agent_tool_config",
      "approval_queue",
      "escalations",
      "conversations",
      "reporting",
      "a2a_config",
      "agent_platform",
      "designer",
      "security_settings",
      "audit_log",
      "users_roles",
      "developer_portal",
    ].map((m) => [m, "None"]),
  ) as PermissionMatrix;
  return { ...base, ...overrides };
}

describe("assertScopeWithinAccountMatrix (Phase 4, BL-36)", () => {
  it("allows a scope that exactly matches the account matrix", () => {
    expect(() => assertScopeWithinAccountMatrix(matrix({ connectors: "Write" }), matrix({ connectors: "Write" }))).not.toThrow();
  });

  it("allows a scope that narrows (Write account, Read scope)", () => {
    expect(() => assertScopeWithinAccountMatrix(matrix({ connectors: "Write" }), matrix({ connectors: "Read" }))).not.toThrow();
  });

  it("rejects a scope that widens beyond the account's own level", () => {
    expect(() => assertScopeWithinAccountMatrix(matrix({ connectors: "Read" }), matrix({ connectors: "Write" }))).toThrow(
      ApiKeyScopeExceedsAccountError,
    );
  });

  it("rejects a scope granting a module the account has no access to at all", () => {
    expect(() => assertScopeWithinAccountMatrix(matrix({}), matrix({ agent_platform: "Read" }))).toThrow(ApiKeyScopeExceedsAccountError);
  });
});

describe("intersectMatrices (Phase 4, BL-36) — the real per-request enforcement path", () => {
  it("returns the account matrix unchanged when no scope is set", () => {
    const account = matrix({ connectors: "Write" });
    expect(intersectMatrices(account, null)).toEqual(account);
  });

  it("takes the per-module MINIMUM of account and scope — a Write-account key scoped to Read cannot Write", () => {
    const effective = intersectMatrices(matrix({ connectors: "Write" }), matrix({ connectors: "Read" }));
    expect(effective.connectors).toBe("Read");
  });

  it("never widens even if a corrupted/manually-crafted scope row claims Write beyond the account's Read", () => {
    // Defense in depth: even if `assertScopeWithinAccountMatrix`'s save-time check
    // were somehow bypassed, the per-request intersection must still cap it.
    const effective = intersectMatrices(matrix({ connectors: "Read" }), matrix({ connectors: "Write" }));
    expect(effective.connectors).toBe("Read");
  });
});
