import { dispatchWebhooksAcrossAllTenants } from "@nextbot/webhooks";

/** Target Architecture Blueprint Phase 18 (BL-49, FR-API-02) — the outbound-webhook
 * dispatcher: enqueues newly-eligible `domain_event` rows per active subscription and
 * attempts every currently-due delivery (retry/backoff via `domain/backoff.ts`).
 * Scheduled every 10s (`index.ts`) — a shorter cadence than the 30s `audit.
 * outbox-sync` job it shares the `domain_event` table with, since a tenant's outbound
 * integration is more latency-sensitive than the in-console Audit Log Viewer. */
export async function runWebhooksDispatch(): Promise<{ tenantsChecked: number; enqueued: number; attempted: number; delivered: number }> {
  return dispatchWebhooksAcrossAllTenants();
}
