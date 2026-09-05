import type pino from 'pino';
import type { OutboxConsumer } from '../../domain/outbox-consumer.types';

/**
 * A minimal, first real {@link OutboxConsumer} — proves the outbox delivery/idempotency mechanism
 * end to end against a genuine business event (`user.created`, enqueued by
 * `UserAdminRepository.insert`) without inventing a fake feature.
 *
 * **Deliberately a placeholder, not a port of legacy's `AuditTrailOutboxConsumer`** (per this
 * dispatch's own instruction to check `platform/audit` first): legacy's real consumer writes to
 * `platform.audit_log` via `AuditLogService`, and neither that table nor that service exists in this
 * app yet — `platform/audit` is explicitly Phase 2 scope (migration plan: "Platform Admin console...
 * `platform/audit`"). Building a fake in-memory audit log here would be scope creep; building a real
 * one would be redoing Phase 2's job early. Instead, this consumer degrades to structured logging
 * (the same "substitute a logged no-op for infrastructure that doesn't exist yet" pattern
 * `NoopEmailAdapter` already establishes for real SMTP) — it is a genuine, durable, idempotency-
 * guarded consumer, just not yet backed by a queryable audit table. Phase 2 should replace (or add
 * alongside) this consumer with a real `platform/audit`-backed one, wiring it to `examType.finalized`
 * and any other event once those modules exist, exactly as legacy's own `AuditTrailOutboxConsumer` is
 * wired.
 */
export class LoggingAuditTrailConsumer implements OutboxConsumer {
  readonly name = 'logging-audit-trail';
  readonly eventTypes = ['user.created'];

  constructor(private readonly logger: pino.Logger) {}

  async handle(payload: Record<string, unknown>, eventId: string): Promise<void> {
    // Synchronous, in-process, and never throws by construction (pino's own fail-safe file-sink
    // behavior, ported from Phase 0 — see `server/logging`) — this consumer can never itself cause a
    // spurious outbox delivery failure the way a real downstream side effect might.
    this.logger.info({ eventId, ...payload }, 'outbox.user.created');
    await Promise.resolve();
  }
}
