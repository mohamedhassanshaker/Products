import { describe, expect, it } from "vitest";
import type { Principal } from "../../platform/tenancy/tenant-context.js";
import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import { AssuranceInsufficientError } from "../domain/assurance.js";
import {
  PERMISSIONS,
  PermissionDeniedError,
  SEEDED_ROLES,
  SEEDED_ROLE_PERMISSIONS,
  type Permission,
  type SeededRole,
} from "../domain/permissions.js";
import { requireAssurance, requirePermission } from "./require-permission.js";

/**
 * Permission and assurance requirements.
 *
 * The failure cases carry the value. A check that throws when it should is easy
 * to write; a check that throws in *every* case where it should is what deny by
 * default means, so these tests walk all 7 roles against all 8 permissions rather
 * than sampling.
 *
 * They also assert what the `Principal` does not contain — the property ADR-0006
 * rule 1 rests on — because that is the assertion that fails if someone
 * "helpfully" widens the type later.
 *
 * Covers FR-IAM-11..18, ADR-0006 rules 1 and 7, api.md §12 invariant 2.
 */

function principalWith(
  permissions: readonly string[],
  overrides: Partial<Principal> = {},
): Principal {
  return {
    id: "usr_01JBSARA",
    tenant: "sewa" as TenantSlug,
    displayName: "Sara Al Mazrouei",
    roles: ["AgentDesigner"],
    permissions: new Set(permissions),
    assurance: "L0",
    ...overrides,
  };
}

function principalForRole(role: SeededRole): Principal {
  return principalWith(SEEDED_ROLE_PERMISSIONS[role], { roles: [role] });
}

describe("deny by default, across the whole matrix", () => {
  it.each(SEEDED_ROLES)("%s is refused every permission B9 tab 3 withholds", (role) => {
    const principal = principalForRole(role);
    const granted = new Set<string>(SEEDED_ROLE_PERMISSIONS[role]);

    for (const permission of PERMISSIONS) {
      if (granted.has(permission)) {
        expect(() => requirePermission(principal, permission, "route")).not.toThrow();
      } else {
        expect(() => requirePermission(principal, permission, "route")).toThrow(
          PermissionDeniedError,
        );
      }
    }
  });

  it("refuses everything to a principal with no permissions", () => {
    const nobody = principalWith([]);
    for (const permission of PERMISSIONS) {
      expect(() => requirePermission(nobody, permission, "route")).toThrow(PermissionDeniedError);
    }
  });

  it("refuses a Live Agent the dashboard", () => {
    // B9's matrix gives Live Agent no dashboard access; they land in B8 instead
    // (api.md §3.4 point 5).
    expect(() =>
      requirePermission(principalForRole("LiveAgent"), "dashboard:view", "metrics.overview"),
    ).toThrow(PermissionDeniedError);
  });

  it("refuses an Agent Designer the publish action", () => {
    // The separation of duties in B9's [rule]: authoring and release are
    // different people.
    expect(() =>
      requirePermission(principalForRole("AgentDesigner"), "agents:publish", "agents.publish"),
    ).toThrow(PermissionDeniedError);
  });

  it("is not satisfied by a wildcard or a near-miss name", () => {
    const impostor = principalWith(["*", "agents:*", "agents.publish", "AGENTS:PUBLISH", "admin"]);
    expect(() => requirePermission(impostor, "agents:publish", "agents.publish")).toThrow(
      PermissionDeniedError,
    );
  });
});

describe("composite requirements are AND", () => {
  it("passes only when every permission is held", () => {
    const admin = principalForRole("EntityAdmin");
    expect(() =>
      requirePermission(admin, ["agents:manage", "agents:publish"], "agents.publish"),
    ).not.toThrow();
  });

  it("fails when any one is missing", () => {
    // There is deliberately no OR form: a route that would need one is two
    // routes (api.md §3.4).
    const designer = principalForRole("AgentDesigner");
    expect(() =>
      requirePermission(designer, ["agents:manage", "agents:publish"], "agents.publish"),
    ).toThrow(PermissionDeniedError);
  });

  it("names the first missing permission, deterministically", () => {
    const nobody = principalWith([]);
    try {
      requirePermission(nobody, ["users:manage", "analytics:view"], "iam.inviteUser");
      expect.unreachable("an empty grant set must not satisfy a requirement");
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionDeniedError);
      expect((error as PermissionDeniedError).required).toBe("users:manage");
    }
  });

  it("refuses an empty requirement instead of authorising everything", () => {
    // An empty array is how "every route declares a permission" gets accidentally
    // satisfied by a route that declares nothing.
    const superAdmin = principalForRole("SuperAdmin");
    expect(() => requirePermission(superAdmin, [] as Permission[], "route")).toThrow(
      /empty permission requirement/,
    );
  });
});

describe("the error tells the caller only what they need", () => {
  it("names the required permission and the operation", () => {
    try {
      requirePermission(principalWith([]), "users:manage", "iam.suspendUser");
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as Error).message).toContain("users:manage");
      expect((error as Error).message).toContain("iam.suspendUser");
    }
  });

  it("does not disclose what the principal holds", () => {
    try {
      requirePermission(principalForRole("Analyst"), "users:manage", "iam.suspendUser");
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as Error).message).not.toContain("analytics:view");
      expect((error as Error).message).not.toContain("dashboard:view");
    }
  });
});

describe("the Principal carries no credential material", () => {
  /**
   * ADR-0006 rule 1, asserted structurally. If a password hash, a TOTP secret, a
   * cookie or an OIDC claim ever reaches a feature module, it reaches it through
   * this object — so the object's own key set is the check.
   */
  const FORBIDDEN = [
    "password",
    "passwordHash",
    "hash",
    "secret",
    "totp",
    "totpSecret",
    "token",
    "accessToken",
    "refreshToken",
    "idToken",
    "cookie",
    "sessionCookie",
    "claims",
    "claim",
    "sub",
    "authMethod",
    "idp",
    "provider",
    "credential",
    "credentials",
  ];

  it("exposes only identity, scope and assurance", () => {
    const principal = principalForRole("SuperAdmin");
    expect(Object.keys(principal).sort()).toEqual([
      "assurance",
      "displayName",
      "id",
      "permissions",
      "roles",
      "tenant",
    ]);
  });

  it("has no field that could carry a credential", () => {
    const principal = principalForRole("SuperAdmin");
    const keys = Object.keys(principal).map((key) => key.toLowerCase());
    for (const forbidden of FORBIDDEN) {
      expect(keys).not.toContain(forbidden.toLowerCase());
    }
  });

  it("says nothing about how the principal authenticated", () => {
    // The property that makes swapping LocalPasswordProvider for UAE PASS or
    // Entra ID a change to session creation only. A serialised principal must
    // not reveal the mechanism.
    const serialised = JSON.stringify({
      ...principalForRole("SuperAdmin"),
      permissions: [...principalForRole("SuperAdmin").permissions],
    });
    expect(serialised).not.toMatch(/argon|password|totp|oidc|bearer|jwt|entra|uaepass/i);
  });
});

describe("assurance requirements", () => {
  it("lets an anonymous citizen view a bill balance", () => {
    // B11 tab 2's L0 row. Anonymous is a legitimate state on the citizen surface.
    const citizen = principalWith([], { assurance: "L0", roles: [] });
    expect(() => requireAssurance(citizen, "L0", "bills.viewBalance")).not.toThrow();
  });

  it("refuses a payment at L1", () => {
    const citizen = principalWith([], { assurance: "L1", roles: [] });
    expect(() => requireAssurance(citizen, "L2", "payments.initiate")).toThrow(
      AssuranceInsufficientError,
    );
  });

  it("accepts a payment at L2 and above", () => {
    for (const held of ["L2", "L3"] as const) {
      const citizen = principalWith([], { assurance: held, roles: [] });
      expect(() => requireAssurance(citizen, "L2", "payments.initiate")).not.toThrow();
    }
  });

  it("is independent of permissions — a citizen has none and is still gated", () => {
    // api.md §3.5: citizens have no permissions, they have a level. The two
    // checks must not substitute for one another.
    const citizen = principalWith([], { assurance: "L2", roles: [] });
    expect(() => requireAssurance(citizen, "L2", "payments.initiate")).not.toThrow();
    expect(() => requirePermission(citizen, "dashboard:view", "route")).toThrow(
      PermissionDeniedError,
    );
  });

  it("does not let a Super Admin's permissions substitute for assurance", () => {
    // Swapping identity providers must not touch authorization, and holding
    // every backoffice permission says nothing about a verified Emirates ID.
    const superAdmin = principalForRole("SuperAdmin");
    expect(() => requireAssurance(superAdmin, "L2", "payments.initiate")).toThrow(
      AssuranceInsufficientError,
    );
  });
});
