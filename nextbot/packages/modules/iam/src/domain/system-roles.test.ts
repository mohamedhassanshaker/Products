import { describe, expect, it } from "vitest";
import { RBAC_MODULES } from "@nextbot/contracts";
import { SYSTEM_ROLES } from "./system-roles.js";

describe("SYSTEM_ROLES (LLD §3.3 six seeded roles)", () => {
  it("seeds exactly the six named system roles", () => {
    expect(SYSTEM_ROLES.map((r) => r.name)).toEqual([
      "Tenant Admin",
      "Backend System Owner",
      "Designer",
      "Platform Engineer",
      "Escalation Agent",
      "Read-Only",
    ]);
  });

  it("every role's permission matrix has an explicit entry for every RBAC module", () => {
    for (const role of SYSTEM_ROLES) {
      for (const module of RBAC_MODULES) {
        expect(role.permissionMatrix[module], `${role.name} missing ${module}`).toBeDefined();
      }
    }
  });

  it("Tenant Admin has Write everywhere (tenant's own root role)", () => {
    const tenantAdmin = SYSTEM_ROLES.find((r) => r.name === "Tenant Admin")!;
    for (const module of RBAC_MODULES) {
      expect(tenantAdmin.permissionMatrix[module]).toBe("Write");
    }
  });

  it("Read-Only never grants Write anywhere", () => {
    const readOnly = SYSTEM_ROLES.find((r) => r.name === "Read-Only")!;
    for (const module of RBAC_MODULES) {
      expect(readOnly.permissionMatrix[module]).not.toBe("Write");
    }
  });

  it("Escalation Agent has Write on approval_queue and escalations only", () => {
    const escalationAgent = SYSTEM_ROLES.find((r) => r.name === "Escalation Agent")!;
    const writeModules = RBAC_MODULES.filter((m) => escalationAgent.permissionMatrix[m] === "Write");
    expect(writeModules.sort()).toEqual(["approval_queue", "escalations"].sort());
  });
});
