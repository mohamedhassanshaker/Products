import type { AuditActorType } from '@/server/infrastructure/database';

/** Fields a caller supplies to append one audit row (`id`/`createdAt` are generated at the
 * repository level) — ported verbatim shape from `legacy/api/src/platform/audit/infrastructure/
 * repositories/audit-log.repository.ts`'s `AuditLogEntry`. */
export interface AuditLogEntry {
  actorType: AuditActorType;
  actorId?: string | null;
  tenantId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  summary?: Record<string, unknown> | null;
  ip?: string | null;
}

/** One page of the Audit Log console screen's own filterable listing (§18.10 of
 * `docs/design/UX_GUIDELINES.md`) — new this dispatch, no legacy HTTP precedent (legacy never built
 * an admin-facing audit viewer). */
export interface AuditLogListOptions {
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  page?: number;
  pageSize?: number;
}

/** One audit row as returned to the console (dates as ISO strings — the wire-shape convention every
 * other summary type in this app already follows, e.g. `TenantSummary`). */
export interface AuditLogRow {
  id: string;
  actorType: AuditActorType;
  actorId: string | null;
  tenantId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface AuditLogListResult {
  items: AuditLogRow[];
  total: number;
}
