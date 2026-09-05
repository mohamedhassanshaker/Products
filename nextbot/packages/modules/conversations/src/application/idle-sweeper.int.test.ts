import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, schema } from "@nextbot/db";
import { createWebWidgetChannel } from "@nextbot/channels";
import { createWidgetSession } from "./create-widget-session.js";
import { sweepIdleConversationsForTenant, sweepIdleConversationsAcrossAllTenants } from "./idle-sweeper.js";
import { insertMessage } from "../infrastructure/message-repository.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});
beforeEach(() => {
  process.env.NEXTBOT_WIDGET_SESSION_SECRET = "a-sufficiently-long-test-widget-secret-1234";
});

/** Backdates a conversation's `last_activity_at` past the idle timeout — the sweep
 * only ever looks at `last_activity_at`, so this is the one thing a test must fake to
 * exercise it without a real 30-minute wait. */
async function backdateActivity(ctx: Awaited<ReturnType<typeof createFixtureTenant>>, conversationId: string, minutesAgo: number) {
  await withTenant(ctx, async (db) => {
    await db
      .update(schema.conversation)
      .set({ lastActivityAt: new Date(Date.now() - minutesAgo * 60_000) })
      .where(eq(schema.conversation.id, conversationId));
  });
}

describe("sweepIdleConversationsForTenant (LLD §3.7 idle-sweep job, real Postgres)", () => {
  it("marks an idle conversation with zero customer messages as Abandoned", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channel = await createWebWidgetChannel(tenant, { name: "Sweep Widget", environment: "Sandbox" });
    const session = await createWidgetSession({ tenantSlug: await tenantSlugOf(tenant.tenantId), channelPublicKey: channel.publicKey });
    await backdateActivity(tenant, session.conversationId, 45);

    const result = await sweepIdleConversationsForTenant(tenant, 30);
    expect(result).toEqual({ abandoned: 1, resolved: 0 });

    const row = await withTenant(tenant, (db) => db.select().from(schema.conversation).where(eq(schema.conversation.id, session.conversationId)));
    expect(row[0]?.status).toBe("Abandoned");
    expect(row[0]?.resolutionType).toBe("Abandoned");
    expect(row[0]?.endedAt).not.toBeNull();
  });

  it("marks an idle conversation with at least one customer message as Resolved/AI", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channel = await createWebWidgetChannel(tenant, { name: "Sweep Widget 2", environment: "Sandbox" });
    const session = await createWidgetSession({ tenantSlug: await tenantSlugOf(tenant.tenantId), channelPublicKey: channel.publicKey });
    await insertMessage(tenant, { conversationId: session.conversationId, sender: "Customer", contentType: "Text", payload: { contentType: "Text", text: "hi" } });
    await backdateActivity(tenant, session.conversationId, 45);

    const result = await sweepIdleConversationsForTenant(tenant, 30);
    expect(result).toEqual({ abandoned: 0, resolved: 1 });

    const row = await withTenant(tenant, (db) => db.select().from(schema.conversation).where(eq(schema.conversation.id, session.conversationId)));
    expect(row[0]?.status).toBe("Resolved");
    expect(row[0]?.resolutionType).toBe("AI");
  });

  it("leaves a conversation active if it hasn't been idle long enough yet", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channel = await createWebWidgetChannel(tenant, { name: "Sweep Widget 3", environment: "Sandbox" });
    const session = await createWidgetSession({ tenantSlug: await tenantSlugOf(tenant.tenantId), channelPublicKey: channel.publicKey });
    await backdateActivity(tenant, session.conversationId, 5);

    const result = await sweepIdleConversationsForTenant(tenant, 30);
    expect(result).toEqual({ abandoned: 0, resolved: 0 });

    const row = await withTenant(tenant, (db) => db.select().from(schema.conversation).where(eq(schema.conversation.id, session.conversationId)));
    expect(row[0]?.status).toBe("Active");
  });

  it("does not touch an already-Escalated conversation even if idle", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channel = await createWebWidgetChannel(tenant, { name: "Sweep Widget 4", environment: "Sandbox" });
    const session = await createWidgetSession({ tenantSlug: await tenantSlugOf(tenant.tenantId), channelPublicKey: channel.publicKey });
    await withTenant(tenant, (db) => db.update(schema.conversation).set({ status: "Escalated" }).where(eq(schema.conversation.id, session.conversationId)));
    await backdateActivity(tenant, session.conversationId, 45);

    const result = await sweepIdleConversationsForTenant(tenant, 30);
    expect(result).toEqual({ abandoned: 0, resolved: 0 });
  });
});

describe("sweepIdleConversationsAcrossAllTenants", () => {
  it("sweeps every active tenant and aggregates the counts", async () => {
    const tenantA = await createFixtureTenant();
    const tenantB = await createFixtureTenant();
    createdTenantIds.push(tenantA.tenantId, tenantB.tenantId);
    // `listActiveTenantContexts` (the cross-tenant seam this function reuses, per its
    // own doc) filters `tenant.status = 'Active'` — `createFixtureTenant` leaves the
    // schema default (`'Trial'`), so this test flips both fixtures to `Active` to
    // exercise the real cross-tenant path rather than silently testing zero tenants.
    for (const t of [tenantA, tenantB]) {
      await withTenant(t, (db) => db.update(schema.tenant).set({ status: "Active" }).where(eq(schema.tenant.id, t.tenantId)));
    }
    const channelA = await createWebWidgetChannel(tenantA, { name: "A", environment: "Sandbox" });
    const channelB = await createWebWidgetChannel(tenantB, { name: "B", environment: "Sandbox" });
    const sessionA = await createWidgetSession({ tenantSlug: await tenantSlugOf(tenantA.tenantId), channelPublicKey: channelA.publicKey });
    const sessionB = await createWidgetSession({ tenantSlug: await tenantSlugOf(tenantB.tenantId), channelPublicKey: channelB.publicKey });
    await backdateActivity(tenantA, sessionA.conversationId, 45);
    await backdateActivity(tenantB, sessionB.conversationId, 45);

    const result = await sweepIdleConversationsAcrossAllTenants(30);
    expect(result.tenantsChecked).toBeGreaterThanOrEqual(2);
    expect(result.abandoned).toBeGreaterThanOrEqual(2);
  });
});

async function tenantSlugOf(tenantId: string): Promise<string> {
  const { resolveTenantById } = await import("@nextbot/tenancy");
  const tenant = await resolveTenantById(tenantId);
  return tenant?.slug ?? "";
}
