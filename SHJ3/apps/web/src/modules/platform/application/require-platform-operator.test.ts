import { describe, expect, it } from "vitest";
import {
  PlatformOperatorDeniedError,
  RequirePlatformOperator,
} from "./require-platform-operator.js";
import type { TenantProfileReader } from "../ports/tenant-profile-reader.js";
import type { Principal } from "../tenancy/tenant-context.js";
import { assertValidSlugShape } from "../tenancy/tenant-slug.js";

class FakeTenantProfileReader implements TenantProfileReader {
  constructor(private readonly isPlatform: boolean) {}
  async isPlatformTenant(): Promise<boolean> {
    return this.isPlatform;
  }
}

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    tenant: assertValidSlugShape("sharjah"),
    displayName: "Test User",
    roles: ["SuperAdmin"],
    permissions: new Set<string>(),
    assurance: "L2",
    ...overrides,
  };
}

describe("RequirePlatformOperator", () => {
  it("passes for a principal with platform:operate signed in through the real Platform tenant", async () => {
    const gate = new RequirePlatformOperator({ tenantProfile: new FakeTenantProfileReader(true) });
    await expect(
      gate.execute(principal({ permissions: new Set(["platform:operate"]) }), "test.op"),
    ).resolves.toBeUndefined();
  });

  it("refuses a tenant SuperAdmin who self-granted platform:operate in their own matrix but is not the Platform tenant", async () => {
    // This is the exact scenario the compound gate exists to close: B9 tab 3 lets any
    // tenant's own SuperAdmin toggle any matrix cell for their own tenant at runtime, so
    // the permission alone is not the boundary.
    const gate = new RequirePlatformOperator({ tenantProfile: new FakeTenantProfileReader(false) });
    await expect(
      gate.execute(principal({ permissions: new Set(["platform:operate"]) }), "test.op"),
    ).rejects.toBeInstanceOf(PlatformOperatorDeniedError);
  });

  it("refuses a real Platform tenant principal who lacks the platform:operate permission", async () => {
    const gate = new RequirePlatformOperator({ tenantProfile: new FakeTenantProfileReader(true) });
    await expect(
      gate.execute(principal({ permissions: new Set() }), "test.op"),
    ).rejects.toBeInstanceOf(PlatformOperatorDeniedError);
  });

  it("refuses when neither condition holds", async () => {
    const gate = new RequirePlatformOperator({ tenantProfile: new FakeTenantProfileReader(false) });
    await expect(
      gate.execute(principal({ permissions: new Set() }), "test.op"),
    ).rejects.toBeInstanceOf(PlatformOperatorDeniedError);
  });
});
