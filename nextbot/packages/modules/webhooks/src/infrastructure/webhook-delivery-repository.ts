import { and, asc, eq, inArray, gte, notInArray, sql } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { WebhookEventCategoryValue } from "@nextbot/contracts";

export interface WebhookDeliveryRow {
  id: string;
  tenantId: string;
  subscriptionId: string;
  domainEventId: string;
  eventCategory: WebhookEventCategoryValue;
  status: "Pending" | "Success" | "Failed" | "Exhausted";
  attemptCount: number;
  lastResponseCode: number | null;
  lastErrorMessage: string | null;
  nextAttemptAt: Date;
  deliveredAt: Date | null;
  createdAt: Date;
}

/**
 * Enqueues one `webhook_delivery` row (status `Pending`) for every `domain_event` row
 * matching `domainEventTypes`, created after `sinceCreatedAt` (a fresh subscription
 * does not retroactively deliver a tenant's entire event history), that this
 * subscription has not already been enqueued for. Deliberately a single `INSERT ...
 * SELECT ... ON CONFLICT DO NOTHING` statement — this is what makes the enqueue step
 * safe under a concurrently-ticking worker replica (`webhook_delivery_subscription_
 * event_key`'s uniqueness is what `ON CONFLICT` targets), never a check-then-insert
 * race.
 *
 * `domain_event`'s own RLS policy (it is tenant-scoped, `TENANT_SCOPED_TABLES`)
 * already restricts the `SELECT` below to `ctx.tenantId`'s own rows — no additional
 * tenant predicate is needed on that side of the join, only on `webhook_subscription`.
 *
 * This function reads `domain_event` but never touches its `processed`/`processed_at`
 * columns — `@nextbot/audit`'s own private cursor (see this module's schema-file doc
 * comment for the full non-interference rationale) — so this dispatcher's progress
 * can never race with, skip past, or be skipped past by audit-sync's.
 */
export async function enqueuePendingDeliveries(
  ctx: TenantContext,
  subscriptionId: string,
  domainEventTypes: string[],
  eventCategory: WebhookEventCategoryValue,
  sinceCreatedAt: Date,
): Promise<number> {
  if (domainEventTypes.length === 0) return 0;
  return withTenant(ctx, async (db: TenantScopedClient) => {
    // Step 1: read candidate `domain_event` ids — a plain, parameterized read (never
    // string-concatenated; `domainEventTypes` come from this module's own static
    // `EVENT_CATEGORY_TO_DOMAIN_EVENT_TYPES` map, not user input, but `inArray` keeps
    // this parameterized regardless). `domain_event`'s own RLS policy already scopes
    // this to `ctx.tenantId`'s rows.
    const alreadyTracked = db
      .select({ domainEventId: schema.webhookDelivery.domainEventId })
      .from(schema.webhookDelivery)
      .where(eq(schema.webhookDelivery.subscriptionId, subscriptionId));
    const candidates = await db
      .select({ id: schema.domainEvent.id })
      .from(schema.domainEvent)
      .where(
        and(
          eq(schema.domainEvent.tenantId, ctx.tenantId),
          inArray(schema.domainEvent.type, domainEventTypes),
          gte(schema.domainEvent.createdAt, sinceCreatedAt),
          notInArray(schema.domainEvent.id, alreadyTracked),
        ),
      );
    if (candidates.length === 0) return 0;

    // Step 2: batch-insert with app-generated UUIDv7 ids (this codebase's own id
    // convention — every other repository generates ids in application code, never
    // via a SQL-side default), `ON CONFLICT DO NOTHING` on the same unique index that
    // guarantees this is race-safe against a concurrently-ticking worker replica: even
    // if two replicas compute overlapping candidate sets, at most one row per
    // (subscription, domain_event) pair ever survives.
    const result = await db
      .insert(schema.webhookDelivery)
      .values(
        candidates.map((c) => ({
          id: generateId(),
          tenantId: ctx.tenantId,
          subscriptionId,
          domainEventId: c.id,
          eventCategory,
          status: "Pending" as const,
        })),
      )
      .onConflictDoNothing({ target: [schema.webhookDelivery.subscriptionId, schema.webhookDelivery.domainEventId] });
    return result.rowCount ?? candidates.length;
  });
}

/** The dispatcher's own claim query: every delivery due for an attempt right now
 * (`Pending` — never yet attempted — or `Failed` and past its own backoff-scheduled
 * `next_attempt_at`), oldest first, capped at `limit` per tick so one subscription
 * with a large backlog cannot starve every other tenant's dispatcher tick. */
export async function listDueDeliveries(ctx: TenantContext, limit: number): Promise<WebhookDeliveryRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.webhookDelivery)
      .where(
        and(
          eq(schema.webhookDelivery.tenantId, ctx.tenantId),
          sql`${schema.webhookDelivery.status} IN ('Pending','Failed')`,
          sql`${schema.webhookDelivery.nextAttemptAt} <= now()`,
        ),
      )
      .orderBy(asc(schema.webhookDelivery.createdAt))
      .limit(limit);
    return rows as WebhookDeliveryRow[];
  });
}

export async function markDeliverySucceeded(ctx: TenantContext, id: string, responseCode: number): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.webhookDelivery)
      .set({ status: "Success", lastResponseCode: responseCode, lastErrorMessage: null, deliveredAt: new Date(), attemptCount: sql`attempt_count + 1` })
      .where(and(eq(schema.webhookDelivery.tenantId, ctx.tenantId), eq(schema.webhookDelivery.id, id)));
  });
}

/** Records a failed attempt. `nextAttempt`/`exhausted` are computed by the caller
 * (`application/webhook-dispatch-service.ts`, via `domain/backoff.ts`) — this
 * repository function only persists the decision, it never decides the policy
 * itself. */
export async function markDeliveryFailed(
  ctx: TenantContext,
  id: string,
  input: { responseCode: number | null; errorMessage: string; nextAttemptAt: Date; exhausted: boolean },
): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.webhookDelivery)
      .set({
        status: input.exhausted ? "Exhausted" : "Failed",
        lastResponseCode: input.responseCode,
        lastErrorMessage: input.errorMessage.slice(0, 2000),
        nextAttemptAt: input.nextAttemptAt,
        attemptCount: sql`attempt_count + 1`,
      })
      .where(and(eq(schema.webhookDelivery.tenantId, ctx.tenantId), eq(schema.webhookDelivery.id, id)));
  });
}

/** The per-tenant delivery-log screen's read side (FR-API-02's own required
 * "delivery-log for debugging failed deliveries"), newest first. */
export async function listDeliveriesForSubscription(ctx: TenantContext, subscriptionId: string, limit = 100): Promise<WebhookDeliveryRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.webhookDelivery)
      .where(and(eq(schema.webhookDelivery.tenantId, ctx.tenantId), eq(schema.webhookDelivery.subscriptionId, subscriptionId)))
      .orderBy(sql`${schema.webhookDelivery.createdAt} DESC`)
      .limit(limit);
    return rows as WebhookDeliveryRow[];
  });
}

/** Test/dispatcher-only helper: fetches one delivery row by id. */
export async function getDeliveryById(ctx: TenantContext, id: string): Promise<WebhookDeliveryRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.webhookDelivery).where(and(eq(schema.webhookDelivery.tenantId, ctx.tenantId), eq(schema.webhookDelivery.id, id)));
    return (rows[0] as WebhookDeliveryRow | undefined) ?? null;
  });
}

/** Generates a fresh uuid for a caller that doesn't need the DB's own `gen_random_uuid()`
 * default (kept for symmetry with every other repository in this codebase, even though
 * `enqueuePendingDeliveries` above generates its ids at the SQL level). */
export function newDeliveryId(): string {
  return generateId();
}
