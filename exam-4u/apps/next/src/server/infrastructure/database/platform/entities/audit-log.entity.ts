import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/** The three actor kinds an audit row can be attributed to — ported verbatim from
 * `legacy/api/src/infrastructure/database/platform/entities/audit-log.entity.ts`. `System` covers
 * webhook-driven mutations (`BillingWebhookService`) that have no human `PlatformAdmin`/`TenantUser`
 * actor at all. */
export type AuditActorType = 'PlatformAdmin' | 'TenantUser' | 'System';

/**
 * TypeORM mapping for `platform.audit_log` (HLD §5.3: "actor, action, target, before/after summary,
 * ip") — ported verbatim from legacy's identically-named entity. Lives alongside every other
 * platform-schema entity under `infrastructure/database/platform/entities/**` (this app's own
 * established "one central location per DataSource" convention — see `TenantEntity`'s doc comment).
 *
 * Append-only from the application's perspective: {@link import('../../../../platform/audit').AuditLogRepository}
 * exposes no `update()`/`delete()` method — the only write path is `insert`, matching an audit
 * trail's own purpose.
 *
 * **Registration reminder** (the same Dev-9a/Phase-1-QA lesson this app's `tenant.entity.ts`/
 * `approved-ai-model.entity.ts` doc comments already document): this entity must be added to
 * `PLATFORM_ENTITIES` (`./index.ts`) or every repository built against it throws TypeORM's
 * `EntityMetadataNotFoundError` against a real `DataSource` despite passing mocked unit tests.
 */
@Entity({ name: 'audit_log' })
export class AuditLogEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'actor_type', type: 'enum', enum: ['PlatformAdmin', 'TenantUser', 'System'] })
  actorType!: AuditActorType;

  @Column({ name: 'actor_id', type: 'varchar', length: 64, nullable: true })
  actorId!: string | null;

  @Index()
  @Column({ name: 'tenant_id', type: 'char', length: 36, nullable: true })
  tenantId!: string | null;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  action!: string;

  @Column({ name: 'target_type', type: 'varchar', length: 100, nullable: true })
  targetType!: string | null;

  @Index()
  @Column({ name: 'target_id', type: 'varchar', length: 64, nullable: true })
  targetId!: string | null;

  /** Structured, human-reviewable "before/after" summary — deliberately typed
   * `Record<string, unknown> | null` rather than a rigid shape, since what's worth recording differs
   * per action. */
  @Column({ type: 'json', nullable: true })
  summary!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
