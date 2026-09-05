import type pino from 'pino';
import type { AuditLogRepository } from '../infrastructure/audit-log.repository';
import type { AuditLogEntry, AuditLogListOptions, AuditLogListResult } from '../domain/audit-log.types';

/**
 * Thin application-layer wrapper over {@link AuditLogRepository} — ported logic (not code) from
 * `legacy/api/src/platform/audit/application/audit-log.service.ts`'s `AuditLogService`.
 *
 * **Deliberately fail-open, never fail-closed**: a logging failure must never abort the mutating
 * platform-admin action it's recording (the same "never let a logging failure throw into the request
 * that triggered it" rule this project already applies to pino's file-sink fallback) — an audit write
 * is important-but-secondary to the action it describes actually succeeding. Every mutating Route
 * Handler this dispatch retrofits calls {@link record} **after** its own primary action has already
 * succeeded, and never awaits it in a way that could turn a `record()` failure into the caller's own
 * failure (this method itself never throws, so that's structurally guaranteed regardless of call
 * order — but the ordering is still deliberate: an audit write is never in the critical path of
 * deciding whether the primary action succeeded).
 */
export class AuditLogService {
  constructor(
    private readonly repo: AuditLogRepository,
    private readonly logger: pino.Logger,
  ) {}

  /** Records one audit row (HLD §5.3: "actor, action, target, before/after summary, ip"). Swallows
   * (and logs) any failure rather than propagating it to the caller. */
  async record(entry: AuditLogEntry): Promise<void> {
    try {
      await this.repo.append(entry);
    } catch (err) {
      this.logger.error({ err, entry }, 'audit_log_write_failed');
    }
  }

  /** Read path for the Audit Log console page (§18.10) — a plain, unguarded delegation (this is a
   * read, not a mutation, so there's nothing to fail open/closed about). */
  async list(options: AuditLogListOptions): Promise<AuditLogListResult> {
    return this.repo.findMany(options);
  }
}
