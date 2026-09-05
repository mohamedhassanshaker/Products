import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { schema, withTenant, generateId, type TenantScopedClient } from "@nextbot/db";
import { syncAuditFromEventsForTenant } from "./sync-audit-from-events.js";
import { queryAuditLog } from "./query-audit.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

/**
 * Phase 17 (BL-10) — the audit outbox consumer, exercised against a real Postgres
 * `domain_event` row (this dispatch's bounded "audit-completeness" bar: every
 * `domain_event` row this system currently produces is faithfully mirrored — see
 * this module's own doc for the flagged scope note on retrofitting outbox writes
 * onto every Phase 1-16 mutating endpoint, which is out of scope here).
 */
describe("syncAuditFromEventsForTenant (Phase 17, BL-10, real Postgres)", () => {
  it("mirrors an unprocessed domain_event row into audit_log_entry and marks it processed", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const eventId = generateId();
    await withTenant(ctx, async (db: TenantScopedClient) => {
      await db.insert(schema.domainEvent).values({
        id: eventId,
        tenantId: ctx.tenantId,
        type: "ToolCallFailure",
        payload: { actorLabel: "system", targetType: "tool_call", targetId: "tc-1", reason: "timeout" },
      });
    });

    const result = await syncAuditFromEventsForTenant(ctx);
    expect(result.synced).toBe(1);

    const entries = await queryAuditLog(ctx, {});
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actionType).toBe("ToolCallFailure");
    expect(entries[0]!.outcome).toBe("Failure");

    // Re-running the sync must be a no-op — the real proof that the source row was
    // correctly marked `processed = true` (not just that one insert worked).
    const second = await syncAuditFromEventsForTenant(ctx);
    expect(second.synced).toBe(0);

    const entriesAfterSecondSync = await queryAuditLog(ctx, {});
    expect(entriesAfterSecondSync).toHaveLength(1);
  });

  it("classifies a *Denied event as outcome=Denied", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    await withTenant(ctx, async (db: TenantScopedClient) => {
      await db.insert(schema.domainEvent).values({
        id: generateId(),
        tenantId: ctx.tenantId,
        type: "PolicyDenied",
        payload: { actorLabel: "system" },
      });
    });

    await syncAuditFromEventsForTenant(ctx);
    const entries = await queryAuditLog(ctx, {});
    expect(entries[0]!.outcome).toBe("Denied");
  });
});
