import type { TenantContext } from "@nextbot/db";
import type { CreateWebhookSubscriptionRequest, UpdateWebhookSubscriptionRequest } from "@nextbot/contracts";
import { subscribeToWebhooks, listSubscriptions, updateSubscription, unsubscribe } from "../application/webhook-subscription-service.js";
import { getWebhookSubscription } from "../infrastructure/webhook-subscription-repository.js";
import { listDeliveriesForSubscription } from "../infrastructure/webhook-delivery-repository.js";
import { WebhookSubscriptionNotFoundError } from "@nextbot/contracts";

/** Framework-agnostic HTTP handlers, mirroring every other module's own
 * `http/admin-routes.ts` shape — `apps/web`'s Settings route files are thin adapters
 * over these. */

export async function handleListWebhookSubscriptions(ctx: TenantContext) {
  return listSubscriptions(ctx);
}

export async function handleCreateWebhookSubscription(ctx: TenantContext, input: CreateWebhookSubscriptionRequest, createdByUserId: string) {
  return subscribeToWebhooks(ctx, { targetUrl: input.targetUrl, eventCategories: input.eventCategories, createdByUserId });
}

export async function handleUpdateWebhookSubscription(ctx: TenantContext, id: string, input: UpdateWebhookSubscriptionRequest) {
  return updateSubscription(ctx, id, input);
}

export async function handleDeleteWebhookSubscription(ctx: TenantContext, id: string) {
  await unsubscribe(ctx, id);
}

export async function handleListWebhookDeliveries(ctx: TenantContext, subscriptionId: string) {
  const subscription = await getWebhookSubscription(ctx, subscriptionId);
  if (!subscription) throw new WebhookSubscriptionNotFoundError();
  return listDeliveriesForSubscription(ctx, subscriptionId);
}
