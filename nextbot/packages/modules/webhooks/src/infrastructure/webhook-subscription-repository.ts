import { and, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { WebhookEventCategoryValue } from "@nextbot/contracts";

export interface WebhookSubscriptionRow {
  id: string;
  tenantId: string;
  targetUrl: string;
  eventCategories: string[];
  signingSecretCredentialId: string;
  enabled: boolean;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function createWebhookSubscription(
  ctx: TenantContext,
  input: { targetUrl: string; eventCategories: WebhookEventCategoryValue[]; signingSecretCredentialId: string; createdByUserId: string | null },
): Promise<WebhookSubscriptionRow> {
  const id = generateId();
  return withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.webhookSubscription).values({
      id,
      tenantId: ctx.tenantId,
      targetUrl: input.targetUrl,
      eventCategories: input.eventCategories,
      signingSecretCredentialId: input.signingSecretCredentialId,
      createdByUserId: input.createdByUserId,
    });
    const rows = await db.select().from(schema.webhookSubscription).where(eq(schema.webhookSubscription.id, id));
    return rows[0] as WebhookSubscriptionRow;
  });
}

export async function listWebhookSubscriptions(ctx: TenantContext): Promise<WebhookSubscriptionRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.webhookSubscription).where(eq(schema.webhookSubscription.tenantId, ctx.tenantId));
    return rows as WebhookSubscriptionRow[];
  });
}

export async function getWebhookSubscription(ctx: TenantContext, id: string): Promise<WebhookSubscriptionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.webhookSubscription)
      .where(and(eq(schema.webhookSubscription.tenantId, ctx.tenantId), eq(schema.webhookSubscription.id, id)));
    return (rows[0] as WebhookSubscriptionRow | undefined) ?? null;
  });
}

export async function updateWebhookSubscription(
  ctx: TenantContext,
  id: string,
  patch: Partial<Pick<WebhookSubscriptionRow, "targetUrl" | "enabled">> & { eventCategories?: WebhookEventCategoryValue[] },
): Promise<WebhookSubscriptionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.webhookSubscription)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(schema.webhookSubscription.tenantId, ctx.tenantId), eq(schema.webhookSubscription.id, id)));
    const rows = await db
      .select()
      .from(schema.webhookSubscription)
      .where(and(eq(schema.webhookSubscription.tenantId, ctx.tenantId), eq(schema.webhookSubscription.id, id)));
    return (rows[0] as WebhookSubscriptionRow | undefined) ?? null;
  });
}

export async function deleteWebhookSubscription(ctx: TenantContext, id: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.delete(schema.webhookSubscription).where(and(eq(schema.webhookSubscription.tenantId, ctx.tenantId), eq(schema.webhookSubscription.id, id)));
  });
}

/** The dispatcher's own "which subscriptions are even active" read — every enabled
 * subscription for a tenant, regardless of which categories it holds (the dispatcher
 * itself narrows by category per subscription). */
export async function listEnabledWebhookSubscriptions(ctx: TenantContext): Promise<WebhookSubscriptionRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.webhookSubscription)
      .where(and(eq(schema.webhookSubscription.tenantId, ctx.tenantId), eq(schema.webhookSubscription.enabled, true)));
    return rows as WebhookSubscriptionRow[];
  });
}
