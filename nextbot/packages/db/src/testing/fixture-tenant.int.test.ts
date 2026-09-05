import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatform } from "../platform-context.js";
import { schema } from "../index.js";
import { createFixtureTenant, deleteFixtureTenant } from "./index.js";

describe("createFixtureTenant / deleteFixtureTenant (test-only helpers)", () => {
  it("creates a valid tenant + data policy + runtime quota, then tears it down", async () => {
    const ctx = await createFixtureTenant({ region: "EU" });
    expect(ctx.region).toBe("EU");
    expect(ctx.environment).toBe("Sandbox");

    await withPlatform(async (db) => {
      const [row] = await db.select().from(schema.tenant).where(eq(schema.tenant.id, ctx.tenantId));
      expect(row?.region).toBe("EU");
      const [policy] = await db
        .select()
        .from(schema.tenantDataPolicy)
        .where(eq(schema.tenantDataPolicy.tenantId, ctx.tenantId));
      expect(policy).toBeDefined();
      const [quota] = await db
        .select()
        .from(schema.tenantRuntimeQuota)
        .where(eq(schema.tenantRuntimeQuota.tenantId, ctx.tenantId));
      expect(quota).toBeDefined();
    });

    await deleteFixtureTenant(ctx.tenantId);

    await withPlatform(async (db) => {
      const rows = await db.select().from(schema.tenant).where(eq(schema.tenant.id, ctx.tenantId));
      expect(rows).toHaveLength(0);
    });
  });
});
