import type { TenantContext } from "@nextbot/db";
import { computeHmacSha256Hex } from "@nextbot/agent-platform";
import type { WebhookEventCategoryValue } from "@nextbot/contracts";
import { listActiveTenantContexts } from "@nextbot/tenancy";
import { EVENT_CATEGORY_TO_DOMAIN_EVENT_TYPES } from "../domain/event-category.js";
import { nextRetryDelayMs, shouldRetry } from "../domain/backoff.js";
import { listEnabledWebhookSubscriptions, type WebhookSubscriptionRow } from "../infrastructure/webhook-subscription-repository.js";
import { getSigningSecretPlaintext } from "./webhook-subscription-service.js";
import {
  enqueuePendingDeliveries,
  listDueDeliveries,
  markDeliverySucceeded,
  markDeliveryFailed,
  type WebhookDeliveryRow,
} from "../infrastructure/webhook-delivery-repository.js";
import { schema, withTenant, type TenantScopedClient } from "@nextbot/db";
import { eq } from "drizzle-orm";

/**
 * FR-API-02's dispatcher: for every enabled subscription, enqueue any newly-eligible
 * `domain_event` rows (per category, see `domain/event-category.ts`), then attempt
 * every currently-due delivery, signing the payload with the SAME real HMAC-SHA256
 * construction (`computeHmacSha256Hex`, `@nextbot/agent-platform`'s Phase 10 helper,
 * reused verbatim per this phase's own brief — never a second, independently-written
 * implementation) the Git/Meta webhook verification paths already use, just applied
 * in the outbound direction.
 *
 * At-least-once, never silently dropped: a failed delivery is retried with
 * exponential backoff (`domain/backoff.ts`) up to `MAX_DELIVERY_ATTEMPTS`, after which
 * it is marked `Exhausted` (stops retrying) but stays in the log — FR-API-02's own
 * "delivery-log for debugging failed deliveries."
 */
export async function dispatchWebhooksForTenant(ctx: TenantContext, fetchImpl: typeof fetch = fetch): Promise<{ enqueued: number; attempted: number; delivered: number }> {
  const subscriptions = await listEnabledWebhookSubscriptions(ctx);
  let enqueued = 0;
  for (const subscription of subscriptions) {
    for (const category of subscription.eventCategories as WebhookEventCategoryValue[]) {
      const types = EVENT_CATEGORY_TO_DOMAIN_EVENT_TYPES[category];
      if (!types) continue; // an unrecognized category on an old row — fail safe, skip rather than throw.
      enqueued += await enqueuePendingDeliveries(ctx, subscription.id, [...types], category, subscription.createdAt);
    }
  }

  const due = await listDueDeliveries(ctx, 100);
  let attempted = 0;
  let delivered = 0;
  const subscriptionsById = new Map(subscriptions.map((s) => [s.id, s]));
  for (const delivery of due) {
    const subscription = subscriptionsById.get(delivery.subscriptionId);
    // The subscription could have been disabled/deleted between enqueue and this
    // tick — a due delivery for a now-inactive subscription is simply left Pending
    // (never attempted against a target the tenant no longer wants), picked back up
    // automatically if the subscription is re-enabled later.
    if (!subscription) continue;
    attempted++;
    const ok = await attemptDelivery(ctx, subscription, delivery, fetchImpl);
    if (ok) delivered++;
  }

  return { enqueued, attempted, delivered };
}

async function fetchDomainEventPayload(ctx: TenantContext, domainEventId: string): Promise<{ type: string; payload: unknown } | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ type: schema.domainEvent.type, payload: schema.domainEvent.payload })
      .from(schema.domainEvent)
      .where(eq(schema.domainEvent.id, domainEventId));
    return rows[0] ?? null;
  });
}

async function attemptDelivery(ctx: TenantContext, subscription: WebhookSubscriptionRow, delivery: WebhookDeliveryRow, fetchImpl: typeof fetch): Promise<boolean> {
  const event = await fetchDomainEventPayload(ctx, delivery.domainEventId);
  // The source `domain_event` row is expected to always still exist (this table has
  // no purge job) — a missing row is treated as a permanent failure (exhausted
  // immediately, nothing to ever retry) rather than an infinite retry loop.
  if (!event) {
    await markDeliveryFailed(ctx, delivery.id, { responseCode: null, errorMessage: "Source domain_event no longer exists.", nextAttemptAt: new Date(), exhausted: true });
    return false;
  }

  const body = JSON.stringify({
    id: delivery.id,
    category: delivery.eventCategory,
    type: event.type,
    payload: event.payload,
    deliveredAt: new Date().toISOString(),
  });

  try {
    const secret = await getSigningSecretPlaintext(ctx, subscription);
    const signature = `sha256=${computeHmacSha256Hex(secret, body)}`;
    const response = await fetchImpl(subscription.targetUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-nextbot-signature": signature, "x-nextbot-delivery-id": delivery.id },
      body,
    });
    if (response.ok) {
      await markDeliverySucceeded(ctx, delivery.id, response.status);
      return true;
    }
    const attemptCount = delivery.attemptCount + 1;
    await markDeliveryFailed(ctx, delivery.id, {
      responseCode: response.status,
      errorMessage: `Endpoint responded ${response.status}.`,
      nextAttemptAt: new Date(Date.now() + nextRetryDelayMs(attemptCount)),
      exhausted: !shouldRetry(attemptCount),
    });
    return false;
  } catch (err) {
    const attemptCount = delivery.attemptCount + 1;
    await markDeliveryFailed(ctx, delivery.id, {
      responseCode: null,
      errorMessage: err instanceof Error ? err.message : String(err),
      nextAttemptAt: new Date(Date.now() + nextRetryDelayMs(attemptCount)),
      exhausted: !shouldRetry(attemptCount),
    });
    return false;
  }
}

/** `apps/worker`'s own cross-tenant sweep entry point — mirrors `syncAuditFromEventsAcrossAllTenants`/
 * `reconcileDueServersAcrossAllTenants`'s identical shape exactly. */
export async function dispatchWebhooksAcrossAllTenants(fetchImpl: typeof fetch = fetch): Promise<{ tenantsChecked: number; enqueued: number; attempted: number; delivered: number }> {
  const tenants = await listActiveTenantContexts();
  let enqueued = 0;
  let attempted = 0;
  let delivered = 0;
  for (const ctx of tenants) {
    const result = await dispatchWebhooksForTenant(ctx, fetchImpl);
    enqueued += result.enqueued;
    attempted += result.attempted;
    delivered += result.delivered;
  }
  return { tenantsChecked: tenants.length, enqueued, attempted, delivered };
}
