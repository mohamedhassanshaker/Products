import { describe, expect, it } from "vitest";
import {
  PERMISSION_CATALOG,
  PERMISSIONS,
  PermissionDeniedError,
  RESTRICTED_PERMISSIONS,
  ROLE_KEYS,
  SEEDED_ROLES,
  SEEDED_ROLE_DISPLAY_NAMES,
  SEEDED_ROLE_PERMISSIONS,
  isAllowed,
  isPermission,
  resolvePermissions,
  type Permission,
  type SeededRole,
} from "./permissions.js";

/**
 * Authorization tests.
 *
 * B9 tab 3's matrix determines what every other screen permits, so these tests
 * are the closest thing to a specification of the backoffice's access model.
 * The matrix is transcribed from the wireframe cell by cell and asserted here,
 * which means a transcription error fails a test rather than silently widening
 * or narrowing someone's access.
 *
 * The absence assertions matter as much as the presence ones — per testing.md,
 * each role's E2E walkthrough asserts both what it can see and what it cannot.
 *
 * Covers FR-IAM-11 through FR-IAM-18 and NFR-SEC-01.
 */

describe("the seeded matrix matches B9 tab 3 exactly", () => {
  /**
   * Transcribed independently from the wireframe's table, ticks read as booleans.
   * Duplicating the matrix rather than importing it is deliberate: a test that
   * derives its expectation from the code under test proves only that the code
   * equals itself.
   */
  const WIREFRAME: Record<SeededRole, Record<Permission, boolean>> = {
    SuperAdmin: {
      "dashboard:view": true,
      "agents:manage": true,
      "agents:publish": true,
      "knowledge:manage": true,
      "routing:manage": true,
      "escalations:handle": true,
      "users:manage": true,
      "analytics:view": true,
      "appearance:manage": true,
      "evaluation:manage": true,
      "governance:manage": true,
      "security:manage": true,
      "platform:operate": false,
      "orchestration:manage": true,
    },
    EntityAdmin: {
      "dashboard:view": true,
      "agents:manage": true,
      "agents:publish": true,
      "knowledge:manage": true,
      "routing:manage": true,
      "escalations:handle": false,
      "users:manage": false,
      "analytics:view": true,
      "appearance:manage": true,
      "evaluation:manage": true,
      "governance:manage": true,
      "security:manage": true,
      "platform:operate": false,
      "orchestration:manage": true,
    },
    AgentDesigner: {
      "dashboard:view": true,
      "agents:manage": true,
      "agents:publish": false,
      "knowledge:manage": false,
      "routing:manage": false,
      "escalations:handle": false,
      "users:manage": false,
      "analytics:view": false,
      "appearance:manage": false,
      "evaluation:manage": false,
      "governance:manage": false,
      "security:manage": false,
      "platform:operate": false,
      "orchestration:manage": false,
    },
    KnowledgeManager: {
      "dashboard:view": true,
      "agents:manage": false,
      "agents:publish": false,
      "knowledge:manage": true,
      "routing:manage": false,
      "escalations:handle": false,
      "users:manage": false,
      "analytics:view": false,
      "appearance:manage": false,
      "evaluation:manage": false,
      "governance:manage": false,
      "security:manage": false,
      "platform:operate": false,
      "orchestration:manage": false,
    },
    Reviewer: {
      "dashboard:view": true,
      "agents:manage": false,
      "agents:publish": false,
      "knowledge:manage": false,
      "routing:manage": false,
      "escalations:handle": false,
      "users:manage": false,
      "analytics:view": true,
      "appearance:manage": false,
      "evaluation:manage": false,
      "governance:manage": false,
      "security:manage": false,
      "platform:operate": false,
      "orchestration:manage": false,
    },
    LiveAgent: {
      "dashboard:view": false,
      "agents:manage": false,
      "agents:publish": false,
      "knowledge:manage": false,
      "routing:manage": false,
      "escalations:handle": true,
      "users:manage": false,
      "analytics:view": false,
      "appearance:manage": false,
      "evaluation:manage": false,
      "governance:manage": false,
      "security:manage": false,
      "platform:operate": false,
      "orchestration:manage": false,
    },
    Analyst: {
      "dashboard:view": true,
      "agents:manage": false,
      "agents:publish": false,
      "knowledge:manage": false,
      "routing:manage": false,
      "escalations:handle": false,
      "users:manage": false,
      "analytics:view": true,
      "appearance:manage": false,
      "evaluation:manage": false,
      "governance:manage": false,
      "security:manage": false,
      "platform:operate": false,
      "orchestration:manage": false,
    },
  };

  it.each(SEEDED_ROLES)("%s has exactly the granted cells", (role) => {
    const expected = PERMISSIONS.filter((p) => WIREFRAME[role][p]);
    expect([...SEEDED_ROLE_PERMISSIONS[role]].sort()).toEqual([...expected].sort());
  });

  it.each(SEEDED_ROLES)("%s is denied every ungranted cell", (role) => {
    const granted = new Set<string>(SEEDED_ROLE_PERMISSIONS[role]);
    for (const permission of PERMISSIONS) {
      if (WIREFRAME[role][permission]) continue;
      expect(isAllowed(granted, permission)).toBe(false);
    }
  });

  it("covers all 7 roles and 14 permissions", () => {
    expect(SEEDED_ROLES).toHaveLength(7);
    expect(PERMISSIONS).toHaveLength(14);
  });
});

describe("separation of duties", () => {
  it("Agent Designer can build but not publish", () => {
    // B9's [rule]: authoring and release are deliberately different people.
    const designer = new Set<string>(SEEDED_ROLE_PERMISSIONS.AgentDesigner);
    expect(isAllowed(designer, "agents:manage")).toBe(true);
    expect(isAllowed(designer, "agents:publish")).toBe(false);
  });

  it.each(SEEDED_ROLES)("%s may publish only if it is Super Admin or Entity Admin", (role) => {
    const canPublish = new Set<string>(SEEDED_ROLE_PERMISSIONS[role]).has("agents:publish");
    const permitted = RESTRICTED_PERMISSIONS["agents:publish"]!.includes(role);
    expect(canPublish).toBe(permitted);
  });

  it.each(SEEDED_ROLES)(
    "%s may manage appearance only if it is Super Admin or Entity Admin",
    (role) => {
      // design-system.md §9.3: tenant branding is gated exactly like publishing —
      // the same two roles, for the same separation-of-duties reason.
      const canManageAppearance = new Set<string>(SEEDED_ROLE_PERMISSIONS[role]).has(
        "appearance:manage",
      );
      const permitted = RESTRICTED_PERMISSIONS["appearance:manage"]!.includes(role);
      expect(canManageAppearance).toBe(permitted);
    },
  );

  it.each(SEEDED_ROLES)(
    "%s may manage security policy only if it is Super Admin or Entity Admin",
    (role) => {
      const canManageSecurity = new Set<string>(SEEDED_ROLE_PERMISSIONS[role]).has(
        "security:manage",
      );
      const permitted = RESTRICTED_PERMISSIONS["security:manage"]!.includes(role);
      expect(canManageSecurity).toBe(permitted);
    },
  );

  it.each(SEEDED_ROLES)(
    "%s may manage orchestration only if it is Super Admin or Entity Admin",
    (role) => {
      const canManageOrchestration = new Set<string>(SEEDED_ROLE_PERMISSIONS[role]).has(
        "orchestration:manage",
      );
      const permitted = RESTRICTED_PERMISSIONS["orchestration:manage"]!.includes(role);
      expect(canManageOrchestration).toBe(permitted);
    },
  );

  it.each(SEEDED_ROLES)("%s may manage users only if it is Super Admin", (role) => {
    const canManage = new Set<string>(SEEDED_ROLE_PERMISSIONS[role]).has("users:manage");
    expect(canManage).toBe(role === "SuperAdmin");
  });

  it("only Super Admin holds every seedable permission", () => {
    // `platform:operate` is excluded from the count: it is deliberately never
    // seeded to any role, including Super Admin (permissions.ts's own doc
    // comment) — granted only to the Platform tenant's Super Admin by a
    // one-off ops script, never by this provisioning-time matrix.
    const seedablePermissionCount = PERMISSIONS.length - 1;
    for (const role of SEEDED_ROLES) {
      const count = SEEDED_ROLE_PERMISSIONS[role].length;
      if (role === "SuperAdmin") expect(count).toBe(seedablePermissionCount);
      else expect(count).toBeLessThan(seedablePermissionCount);
    }
  });

  it("platform:operate is never seeded to any role", () => {
    for (const role of SEEDED_ROLES) {
      expect(new Set<string>(SEEDED_ROLE_PERMISSIONS[role]).has("platform:operate")).toBe(false);
    }
  });
});

describe("deny by default", () => {
  it("denies everything to an empty grant set", () => {
    const none = new Set<string>();
    for (const permission of PERMISSIONS) {
      expect(isAllowed(none, permission)).toBe(false);
    }
  });

  it("has no wildcard", () => {
    // A wildcard would mean the matrix in B9 tab 3 is not the whole truth, and
    // an editable matrix that is not the whole truth is worse than no matrix.
    const wildcard = new Set(["*", "admin", "all", "agents:*"]);
    for (const permission of PERMISSIONS) {
      expect(isAllowed(wildcard, permission)).toBe(false);
    }
  });

  it("has no role hierarchy — one permission never implies another", () => {
    const managerOnly = new Set<string>(["agents:manage"]);
    expect(isAllowed(managerOnly, "agents:publish")).toBe(false);
    const publisherOnly = new Set<string>(["agents:publish"]);
    expect(isAllowed(publisherOnly, "agents:manage")).toBe(false);
  });

  it("is not fooled by a near-miss permission name", () => {
    const near = new Set([
      "agents:publishing",
      "agents.publish",
      "AGENTS:PUBLISH",
      " agents:publish",
    ]);
    expect(isAllowed(near, "agents:publish")).toBe(false);
  });

  it("rejects unknown permission strings at the type boundary", () => {
    expect(isPermission("agents:publish")).toBe(true);
    expect(isPermission("agents:destroy")).toBe(false);
    expect(isPermission("")).toBe(false);
    expect(isPermission("*")).toBe(false);
  });
});

describe("resolvePermissions", () => {
  it("unions across multiple roles", () => {
    const granted = resolvePermissions(
      ["AgentDesigner", "KnowledgeManager"],
      SEEDED_ROLE_PERMISSIONS,
    );
    expect(granted.has("agents:manage")).toBe(true);
    expect(granted.has("knowledge:manage")).toBe(true);
    // Still cannot publish: a union of two non-publishing roles does not publish.
    expect(granted.has("agents:publish")).toBe(false);
  });

  it("returns an empty set for no roles", () => {
    expect(resolvePermissions([], SEEDED_ROLE_PERMISSIONS).size).toBe(0);
  });

  it("ignores unknown roles rather than throwing", () => {
    // A role deleted from the matrix while a session is live must reduce access,
    // never escalate it or 500 the request.
    const granted = resolvePermissions(["AgentDesigner", "DeletedRole"], SEEDED_ROLE_PERMISSIONS);
    expect([...granted].sort()).toEqual(["agents:manage", "dashboard:view"]);
  });

  it("gives a custom role with an empty grant list nothing", () => {
    // B9's "+ Add custom role" appends a role with all permissions off.
    const granted = resolvePermissions(["CustomRole"], {
      ...SEEDED_ROLE_PERMISSIONS,
      CustomRole: [],
    });
    expect(granted.size).toBe(0);
  });

  it("reflects a runtime matrix edit rather than the seeded one", () => {
    // Every cell in B9 tab 3 is a toggle, so enforcement must read the live
    // matrix — not a compiled-in copy.
    const edited = {
      ...SEEDED_ROLE_PERMISSIONS,
      AgentDesigner: ["agents:publish"] as Permission[],
    };
    const granted = resolvePermissions(["AgentDesigner"], edited);
    expect(granted.has("agents:publish")).toBe(true);
    expect(granted.has("agents:manage")).toBe(false);
  });
});

describe("PERMISSION_CATALOG", () => {
  it("matches PERMISSIONS exactly, in order, with a real B9 tab 3 label for each", () => {
    expect(PERMISSION_CATALOG.map((entry) => entry.key)).toEqual([...PERMISSIONS]);
    expect(PERMISSION_CATALOG.map((entry) => entry.ordinal)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    for (const entry of PERMISSION_CATALOG) {
      expect(entry.displayName.length).toBeGreaterThan(0);
    }
  });

  it("names 'Manage users & teams' for users:manage, transcribed from B9 tab 3's own column header", () => {
    const entry = PERMISSION_CATALOG.find((candidate) => candidate.key === "users:manage");
    expect(entry?.displayName).toBe("Manage users & teams");
  });
});

describe("ROLE_KEYS", () => {
  // Transcribed independently from prisma/sql/001_constraints.sql's
  // TR_RolePermissions_protectSuperAdmin trigger, the one place a persisted Role.key
  // convention was established before B-2 ever wrote a Role row. A drift here would
  // silently defeat the trigger's protection the same way its stale
  // 'manage_users_teams' literal already did before this wave's fix.
  it("gives every seeded role a snake_case key, matching the trigger's own literal for super_admin", () => {
    expect(ROLE_KEYS.SuperAdmin).toBe("super_admin");
    for (const role of SEEDED_ROLES) {
      expect(ROLE_KEYS[role]).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  it("covers exactly the 7 seeded roles with no duplicate key", () => {
    const keys = SEEDED_ROLES.map((role) => ROLE_KEYS[role]);
    expect(keys).toHaveLength(7);
    expect(new Set(keys).size).toBe(7);
  });
});

describe("SEEDED_ROLE_DISPLAY_NAMES", () => {
  it("names every seeded role with a non-empty, B9 tab 1-matching label", () => {
    expect(SEEDED_ROLE_DISPLAY_NAMES.SuperAdmin).toBe("Super Admin");
    expect(SEEDED_ROLE_DISPLAY_NAMES.AgentDesigner).toBe("Agent Designer");
    expect(SEEDED_ROLE_DISPLAY_NAMES.KnowledgeManager).toBe("Knowledge Manager");
    expect(SEEDED_ROLE_DISPLAY_NAMES.LiveAgent).toBe("Live Agent");
    for (const role of SEEDED_ROLES) {
      expect(SEEDED_ROLE_DISPLAY_NAMES[role].length).toBeGreaterThan(0);
    }
  });
});

describe("PermissionDeniedError", () => {
  it("names the required permission and the operation", () => {
    const error = new PermissionDeniedError("agents:publish", "agents.publish");
    expect(error.message).toContain("agents:publish");
    expect(error.message).toContain("agents.publish");
  });

  it("does not disclose what the principal does hold", () => {
    // Telling a caller what they have is an information leak; telling them what
    // they need is the actionable half.
    const error = new PermissionDeniedError("users:manage", "iam.inviteUser");
    expect(error.message).not.toMatch(/dashboard:view|analytics:view|granted|you have/i);
  });
});
