# @nextbot/webhooks

Target Architecture Blueprint Phase 18 (BL-49, FR-API-02) — outbound webhook
subscriptions. Tenants subscribe to five event categories (`EscalationCreated`,
`ApprovalPending`, `GuardrailTripped`, `DeploymentChanged`, `DriftDetected`), delivered
at-least-once with a real HMAC-SHA256 signature (`X-NextBot-Signature`) and
exponential-backoff retry.

- `domain/event-category.ts` — the ONE place the tenant-facing category vocabulary
  maps to real `domain_event.type` strings. A new producer for one of these
  categories only ever needs to add its type string here.
- `domain/backoff.ts` — the retry/backoff policy (pure).
- A SECOND, independent consumer of the existing `domain_event` outbox
  (`packages/db/src/schema/domain-event.ts`) — never touches `processed`/
  `processed_at`, which is `@nextbot/audit`'s own private cursor. Progress is tracked
  entirely by `webhook_delivery`'s own `(subscription_id, domain_event_id)`
  uniqueness.

See `docs/plans/public-api-webhooks-otel-siem-plan.md` for the full design record.
