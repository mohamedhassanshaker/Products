import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { _resetRuntimeQuotaClientForTests } from "./runtime-quota.js";
import { listAllTenants } from "./list-all-tenants.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  await _resetRuntimeQuotaClientForTests();
});

/**
 * Platform Manager console Phase 1 (NFR-11) — the Tenant List screen's data source.
 * Proves the cross-tenant read genuinely sees every tenant (not scoped to any one
 * `TenantContext`) and enriches each row with its live quota gauge.
 */
describe("listAllTenants (NFR-11 Platform Manager console)", () => {
  it("returns every tenant, including one just created via the fixture helper, with its live concurrent-run gauge at 0", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const rows = await listAllTenants();
    const row = rows.find((r) => r.id === ctx.tenantId);
    expect(row).toBeDefined();
    expect(row?.region).toBe(ctx.region);
    expect(row?.liveConcurrentRuns).toBe(0);
    // `createFixtureTenant` doesn't set `status`/`planTier` explicitly — these are
    // the schema-level column defaults ("Trial"/"Starter"), distinct from
    // `provisionTenant()`'s own explicit "Active" override (see that function's
    // doc comment for why it can't rely on the same default).
    expect(row?.status).toBe("Trial");
    expect(row?.planTier).toBe("Starter");
  });
});
