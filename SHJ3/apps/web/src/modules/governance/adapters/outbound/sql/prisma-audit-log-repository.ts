import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import type {
  AuditLogCursor,
  AuditLogEntryRow,
  AuditLogFilter,
  AuditLogPage,
  AuditLogRepository,
} from "../../../ports/audit-log-repository.js";

const OPERATION = "governance audit log";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * READ ONLY — this class has no update/delete method because the port it implements
 * declares none (`AuditLogRepository`'s own module comment). Writing goes through
 * `modules/platform/ports/provisioning.ts`'s `AuditSink`/`TenantAuditSink`, already built
 * and reused directly rather than duplicated.
 *
 * Cursor shape: `(occurredAt, id)` — `AuditLogEntries` has no single already-unique
 * ordinal column the way `ConversationTurns.ordinal` does (the real unique column,
 * `sequenceNo`, is a `BigInt` this port keeps internal to the adapter rather than
 * expose as a cursor primitive, so a future re-keying of the physical column never
 * changes the port's public cursor shape). `occurredAt` ties are broken by `id`.
 */
export class PrismaAuditLogRepository implements AuditLogRepository {
  async list(filter: AuditLogFilter): Promise<AuditLogPage> {
    const limit = clampLimit(filter.limit);
    const where: Record<string, unknown> = {};
    if (filter.actorId) where.actorStaffUserId = filter.actorId;
    if (filter.action) where.action = filter.action;
    if (filter.environmentKey) where.environmentKey = filter.environmentKey;
    if (filter.targetKind) where.targetKind = filter.targetKind;
    if (filter.occurredAtFrom || filter.occurredAtTo) {
      where.occurredAt = {
        ...(filter.occurredAtFrom ? { gte: filter.occurredAtFrom } : {}),
        ...(filter.occurredAtTo ? { lte: filter.occurredAtTo } : {}),
      };
    }
    if (filter.q) {
      where.OR = [
        { summary: { contains: filter.q } },
        { targetLabelSnapshot: { contains: filter.q } },
      ];
    }
    if (filter.cursor) {
      const cursorDate = new Date(filter.cursor.occurredAt);
      where.OR2 = undefined; // placeholder to keep object shape stable under lint
      Object.assign(where, {
        AND: [
          ...(Array.isArray((where as { AND?: unknown[] }).AND)
            ? (where as { AND: unknown[] }).AND
            : []),
          {
            OR: [
              { occurredAt: { lt: cursorDate } },
              { occurredAt: cursorDate, id: { lt: filter.cursor.id } },
            ],
          },
        ],
      });
    }
    delete (where as Record<string, unknown>).OR2;

    const rows = await getTenantDb(OPERATION).auditLogEntry.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const last = page[page.length - 1];
    const nextCursor: AuditLogCursor | null =
      hasMore && last ? { occurredAt: last.occurredAt.toISOString(), id: last.id } : null;

    return { items: page.map(toRow), nextCursor };
  }

  async get(id: string): Promise<AuditLogEntryRow | null> {
    const row = await getTenantDb(OPERATION).auditLogEntry.findUnique({ where: { id } });
    return row ? toRow(row) : null;
  }
}

function clampLimit(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested) || requested <= 0) return DEFAULT_LIMIT;
  return Math.min(requested, MAX_LIMIT);
}

type AuditLogEntryPrismaRow = {
  id: string;
  occurredAt: Date;
  actorStaffUserId: string | null;
  actorDisplayNameSnapshot: string;
  actorRoleSnapshot: string;
  action: string;
  targetKind: string;
  targetId: string | null;
  targetLabelSnapshot: string;
  environmentKey: string | null;
  summary: string;
  beforeJson: string | null;
  afterJson: string | null;
  correlationId: string;
  sequenceNo: bigint;
};

function toRow(row: AuditLogEntryPrismaRow): AuditLogEntryRow {
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    actorStaffUserId: row.actorStaffUserId,
    actorDisplayNameSnapshot: row.actorDisplayNameSnapshot,
    actorRoleSnapshot: row.actorRoleSnapshot,
    action: row.action,
    targetKind: row.targetKind,
    targetId: row.targetId,
    targetLabelSnapshot: row.targetLabelSnapshot,
    environmentKey: row.environmentKey,
    summary: row.summary,
    beforeJson: row.beforeJson,
    afterJson: row.afterJson,
    correlationId: row.correlationId,
    sequenceNo: row.sequenceNo.toString(),
  };
}
