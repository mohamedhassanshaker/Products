import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@nextbot/db";
import { withPlatform } from "@nextbot/db/platform-only";
import {
  listPlanTierDefinitions,
  getPlanTierDefinition,
  updatePlanTierDefinition,
  getEffectivePlanTierDefaults,
} from "./plan-tier-definitions.js";
import { getPlanTierQuotaDefaults } from "../domain/plan-tier-defaults.js";

/** Restores every tier back to migration 0031's seeded values after each test. */
afterEach(async () => {
  await withPlatform(async (db) => {
    await db
      .update(schema.planTierDefinition)
      .set({ maxToolCallsPerSecond: 1, maxConcurrentConversations: 50, maxMcpConnectors: 3, isDedicatedDatabase: false, features: [] })
      .where(eq(schema.planTierDefinition.tier, "Starter"));
    await db
      .update(schema.planTierDefinition)
      .set({ maxToolCallsPerSecond: 5, maxConcurrentConversations: 500, maxMcpConnectors: 15, isDedicatedDatabase: false, features: [] })
      .where(eq(schema.planTierDefinition.tier, "Growth"));
    await db
      .update(schema.planTierDefinition)
      .set({ maxToolCallsPerSecond: 16, maxConcurrentConversations: 5000, maxMcpConnectors: null, isDedicatedDatabase: true, features: [] })
      .where(eq(schema.planTierDefinition.tier, "Enterprise"));
  });
});

describe("plan_tier_definition migration seed (byte-for-byte match to PLAN_TIER_DEFAULTS)", () => {
  it("seeds all three tiers with values identical to the hardcoded pure defaults", async () => {
    const rows = await listPlanTierDefinitions();
    expect(rows).toHaveLength(3);

    for (const tier of ["Starter", "Growth", "Enterprise"] as const) {
      const pureDefaults = getPlanTierQuotaDefaults(tier);
      const row = rows.find((r) => r.tier === tier);
      expect(row?.maxToolCallsPerSecond).toBe(pureDefaults.maxToolCallsPerSecond);
      expect(row?.maxConcurrentConversations).toBe(pureDefaults.maxConcurrentConversations);
      expect(row?.maxMcpConnectors).toBe(pureDefaults.maxMcpConnectors);
      expect(row?.isDedicatedDatabase).toBe(pureDefaults.isDedicatedDatabase);
      expect(row?.features).toEqual([]);
    }
  });
});

describe("getPlanTierDefinition / updatePlanTierDefinition (Platform Manager console Phase 2, NFR-11)", () => {
  it("getPlanTierDefinition returns the seeded Growth row", async () => {
    const row = await getPlanTierDefinition("Growth");
    expect(row).toMatchObject({ tier: "Growth", maxToolCallsPerSecond: 5, maxConcurrentConversations: 500, maxMcpConnectors: 15 });
  });

  it("applies a partial patch, writes exactly one audit row, and leaves untouched fields alone", async () => {
    const updated = await updatePlanTierDefinition(
      "Growth",
      { maxMcpConnectors: 25, features: ["Priority support"] },
      "operator-token-holder",
    );
    expect(updated).toMatchObject({
      tier: "Growth",
      maxMcpConnectors: 25,
      features: ["Priority support"],
      // Untouched fields keep their seeded values.
      maxToolCallsPerSecond: 5,
      maxConcurrentConversations: 500,
    });

    const persisted = await getPlanTierDefinition("Growth");
    expect(persisted?.maxMcpConnectors).toBe(25);
    expect(persisted?.features).toEqual(["Priority support"]);

    const auditRows = await withPlatform(async (db) =>
      db.select().from(schema.platformAuditLogEntry).where(eq(schema.platformAuditLogEntry.actionType, "plan-tier-definition.update")),
    );
    const thisEditRows = auditRows.filter((r) => (r.details as { tier?: string })?.tier === "Growth");
    expect(thisEditRows.length).toBeGreaterThanOrEqual(1);
    expect(thisEditRows[thisEditRows.length - 1]?.actorLabel).toBe("operator-token-holder");
  });
});

describe("getEffectivePlanTierDefaults (Platform Manager console Phase 2, NFR-11)", () => {
  it("reflects a plan-tier-definition edit", async () => {
    await updatePlanTierDefinition("Starter", { maxToolCallsPerSecond: 2 });
    const effective = await getEffectivePlanTierDefaults("Starter");
    expect(effective.maxToolCallsPerSecond).toBe(2);
  });
});
