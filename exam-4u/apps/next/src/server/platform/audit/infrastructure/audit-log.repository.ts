import { randomUUID } from 'node:crypto';
import type { DataSource, Repository } from 'typeorm';
import { AuditLogEntity } from '@/server/infrastructure/database';
import type { AuditLogEntry, AuditLogListOptions, AuditLogListResult, AuditLogRow } from '../domain/audit-log.types';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** Projects a raw `AuditLogEntity` row into the console's wire shape (dates as ISO strings, matching
 * every other summary type in this app). */
function toRow(entity: AuditLogEntity): AuditLogRow {
  return {
    id: entity.id,
    actorType: entity.actorType,
    actorId: entity.actorId,
    tenantId: entity.tenantId,
    action: entity.action,
    targetType: entity.targetType,
    targetId: entity.targetId,
    summary: entity.summary,
    ip: entity.ip,
    createdAt: entity.createdAt.toISOString(),
  };
}

/**
 * The sole place that ever queries `platform.audit_log` — ported logic (not code) from
 * `legacy/api/src/platform/audit/infrastructure/repositories/audit-log.repository.ts`'s
 * `AuditLogRepository`, adapted to this app's DataSource-constructor convention (see
 * `PlatformTenantRepository`'s identical doc comment for why). Append-only by design — no
 * `update()`/`delete()` method exists here, matching `AuditLogEntity`'s own doc comment.
 */
export class AuditLogRepository {
  private readonly repo: Repository<AuditLogEntity>;

  constructor(dataSource: DataSource) {
    // String-name lookup, not the class reference — see `server/tenancy/raw-tenant-lookup.ts`'s doc
    // comment for the full cross-webpack-bundle entity-class-identity explanation this app's every
    // other repository already follows.
    this.repo = dataSource.getRepository<AuditLogEntity>('audit_log');
  }

  async append(entry: AuditLogEntry): Promise<void> {
    const row = this.repo.create({
      id: randomUUID(),
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      tenantId: entry.tenantId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      summary: entry.summary ?? null,
      ip: entry.ip ?? null,
    });
    await this.repo.save(row);
  }

  /** Read path used by the Audit Log console page (§18.10) — new this dispatch, no legacy HTTP
   * precedent (legacy never built an admin-facing audit viewer, only a `findByTenant` test/future-use
   * helper). Every filter is optional and combined with AND; newest-first, matching the console's own
   * "most recent first" convention every other list screen in this app already uses. */
  async findMany(options: AuditLogListOptions): Promise<AuditLogListResult> {
    const page = options.page && options.page > 0 ? Math.floor(options.page) : 1;
    const pageSize =
      options.pageSize && options.pageSize > 0 ? Math.min(Math.floor(options.pageSize), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

    const where: Record<string, string> = {};
    if (options.actorId) where.actorId = options.actorId;
    if (options.action) where.action = options.action;
    if (options.targetType) where.targetType = options.targetType;
    if (options.targetId) where.targetId = options.targetId;

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: items.map(toRow), total };
  }

  /** Read path used only by tests (and any future per-tenant audit surface) — ported verbatim from
   * legacy's identically-named method. */
  async findByTenant(tenantId: string): Promise<AuditLogRow[]> {
    const rows = await this.repo.find({ where: { tenantId }, order: { createdAt: 'ASC' } });
    return rows.map(toRow);
  }
}
