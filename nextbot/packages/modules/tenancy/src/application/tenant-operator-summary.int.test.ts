import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { _resetRuntimeQuotaClientForTests } from "./runtime-quota.js";
import { getTenantOperatorSummary } from "./tenant-operator-summary.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  await _resetRuntimeQuotaClientForTests();
});

/** Platform Manager console Phase 1 (NFR-11) — the Tenant Detail screen's data
 * source: joins `tenant` + its 1:1 policy/quota/route rows. */
describe("getTenantOperatorSummary (NFR-11 Platform Manager console)", () => {
  it("returns a full cross-tenant summary for an existing tenant", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const summary = await getTenantOperatorSummary(ctx.tenantId);
    expect(summary).not.toBeNull();
    expect(summary?.id).toBe(ctx.tenantId);
    expect(summary?.region).toBe(ctx.region);
    expect(summary?.dataPolicy?.retentionTranscriptsDays).toBe(365);
    expect(summary?.runtimeQuota).not.toBeNull();
    expect(summary?.isDedicatedDatabase).toBe(false);
    expect(summary?.liveConcurrentRuns).toBe(0);
  });

  it("returns null for a nonexistent tenant id (caller renders a 404, not an empty-fields page)", async () => {
    const summary = await getTenantOperatorSummary("00000000-0000-7000-8000-000000000000");
    expect(summary).toBeNull();
  });
});
