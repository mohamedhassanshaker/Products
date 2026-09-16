/**
 * `AuditLogEntries` (tenant schema) — READ ONLY. This interface has no update/delete
 * method at all, deliberately: the table is append-only by DB grant and by
 * `TR_AuditLogEntries_blockMutation` (an `INSTEAD OF UPDATE, DELETE` trigger that always
 * throws) — B14 tab 2's rule is absolute ("Entries cannot be edited or deleted by any
 * role, including Super Admin"), so the type system here makes misuse unexpressible
 * rather than merely discouraged, the same "no vocabulary in which to write the wrong
 * thing" discipline `no-unscoped-store-clients` already applies to store clients.
 *
 * Writing an entry goes through `modules/platform/ports/provisioning.ts`'s `AuditSink`
 * (`TenantAuditSink`, already built and already used across `identity`/`transactions`) —
 * reused directly rather than duplicated, since it already wraps
 * `usp_WriteAuditLogEntry` correctly (hash chain computed server-side, per §4.13).
 */

export interface AuditLogEntryRow {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actorStaffUserId: string | null;
  readonly actorDisplayNameSnapshot: string;
  readonly actorRoleSnapshot: string;
  readonly action: string;
  readonly targetKind: string;
  readonly targetId: string | null;
  readonly targetLabelSnapshot: string;
  readonly environmentKey: string | null;
  readonly summary: string;
  readonly beforeJson: string | null;
  readonly afterJson: string | null;
  readonly correlationId: string;
  readonly sequenceNo: string;
}

export interface AuditLogCursor {
  readonly occurredAt: string;
  readonly id: string;
}

export interface AuditLogFilter {
  readonly actorId?: string;
  readonly action?: string;
  readonly environmentKey?: string;
  readonly targetKind?: string;
  readonly occurredAtFrom?: Date;
  readonly occurredAtTo?: Date;
  /** Free-text match over `summary`/`targetLabelSnapshot` (api.md's `q` param). */
  readonly q?: string;
  readonly cursor?: AuditLogCursor;
  readonly limit?: number;
}

export interface AuditLogPage {
  readonly items: readonly AuditLogEntryRow[];
  readonly nextCursor: AuditLogCursor | null;
}

export interface AuditLogRepository {
  list(filter: AuditLogFilter): Promise<AuditLogPage>;
  get(id: string): Promise<AuditLogEntryRow | null>;
}
