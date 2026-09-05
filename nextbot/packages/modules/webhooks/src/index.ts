// PUBLIC API for "@nextbot/webhooks" (Target Architecture Blueprint Phase 18, BL-49,
// FR-API-02). Everything else in this module is private.

export {
  handleListWebhookSubscriptions,
  handleCreateWebhookSubscription,
  handleUpdateWebhookSubscription,
  handleDeleteWebhookSubscription,
  handleListWebhookDeliveries,
} from "./http/admin-routes.js";
export { dispatchWebhooksForTenant, dispatchWebhooksAcrossAllTenants } from "./application/webhook-dispatch-service.js";
export { EVENT_CATEGORY_TO_DOMAIN_EVENT_TYPES, allSubscribableDomainEventTypes, categoriesForDomainEventType } from "./domain/event-category.js";
export { MAX_DELIVERY_ATTEMPTS, nextRetryDelayMs, shouldRetry } from "./domain/backoff.js";
export { isWellFormedHttpsUrl } from "./domain/url-validation.js";
export type { WebhookSubscriptionView } from "./application/webhook-subscription-service.js";
export type { WebhookDeliveryRow } from "./infrastructure/webhook-delivery-repository.js";
