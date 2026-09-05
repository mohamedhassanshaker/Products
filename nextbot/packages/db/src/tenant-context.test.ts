import { describe, expect, it } from "vitest";
import { assertValidTenantContext, withTenant, type TenantContext } from "./tenant-context.js";
import { TenantContextRequiredError } from "./errors.js";

describe("assertValidTenantContext (fail-closed guard, LLD §3.2 rule 4)", () => {
  it("throws when ctx is null/undefined", () => {
    expect(() => assertValidTenantContext(undefined)).toThrow(TenantContextRequiredError);
    expect(() => assertValidTenantContext(null)).toThrow(TenantContextRequiredError);
  });

  it("throws when tenantId is missing or not a UUID", () => {
    expect(() =>
      assertValidTenantContext({ tenantId: "", region: "US", environment: "Sandbox" }),
    ).toThrow(TenantContextRequiredError);
    expect(() =>
      assertValidTenantContext({ tenantId: "not-a-uuid", region: "US", environment: "Sandbox" }),
    ).toThrow(TenantContextRequiredError);
  });

  it("throws on an invalid region or environment", () => {
    const validId = "018f9a3e-2b3e-7c3e-8b3e-2b3e7c3e8b3e";
    expect(() =>
      assertValidTenantContext({ tenantId: validId, region: "MARS" as never, environment: "Sandbox" }),
    ).toThrow(TenantContextRequiredError);
    expect(() =>
      assertValidTenantContext({ tenantId: validId, region: "US", environment: "Nowhere" as never }),
    ).toThrow(TenantContextRequiredError);
  });

  it("accepts a well-formed context", () => {
    const ctx: TenantContext = {
      tenantId: "018f9a3e-2b3e-7c3e-8b3e-2b3e7c3e8b3e",
      region: "US",
      environment: "Sandbox",
    };
    expect(() => assertValidTenantContext(ctx)).not.toThrow();
  });
});

describe("withTenant (fail-closed at the primitive level)", () => {
  it("rejects before opening any database connection when ctx is invalid", async () => {
    // No DATABASE_URL/env is configured in this unit test — if withTenant attempted
    // to open a connection before validating ctx, this would fail with a totally
    // different (connection/env) error instead of TenantContextRequiredError.
    await expect(
      withTenant(undefined as unknown as TenantContext, async () => "unreachable"),
    ).rejects.toThrow(TenantContextRequiredError);

    await expect(
      withTenant({ tenantId: "bad", region: "US", environment: "Sandbox" }, async () => "unreachable"),
    ).rejects.toThrow(TenantContextRequiredError);
  });
});
