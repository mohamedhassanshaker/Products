import { Column, Entity, PrimaryColumn } from 'typeorm';

/** The three kinds of pending-work hint a tenant-side transaction may upsert — ported verbatim from
 * `legacy/api/src/infrastructure/database/platform/entities/tenant-work-hint.entity.ts`. Declared for
 * schema completeness even though this dispatch (and every prior one) wires no producer of a
 * `pdf_session`/`attempt_timeout` hint yet — those belong to the `pdf-processing`/`attempts` modules
 * a later migration-plan phase builds; `outbox` is declared identically even though this app's own
 * `OutboxRepository.enqueue` also does not upsert this table yet (Phase 1c's own documented scope
 * reduction — see that repository's doc comment) — this dispatch ports the read/clear contract
 * faithfully so those later phases have a ready consumer/producer contract, not a stub to apologize
 * for. */
export type TenantWorkHintKind = 'pdf_session' | 'outbox' | 'attempt_timeout';

/**
 * TypeORM mapping for `platform.tenant_work_hint` (HLD §10.2) — ported verbatim from legacy's
 * identically-named entity. Lives under `infrastructure/database/platform` per the same "only the
 * platform `DataSource` knows this entity exists" convention `TenantEntity`'s own doc comment
 * establishes — no tenant `DataSource` is ever built with this entity registered.
 *
 * Composite `(tenant_id, kind)` primary key: at most one pending-since timestamp per tenant per work
 * kind — a second insert for an already-hinted pair is an upsert (`pending_since = LEAST(...)`), never
 * a duplicate row, so "how long has this been pending" always reflects the *oldest* still-unaddressed
 * reason a worker should look at this tenant.
 *
 * **Registration reminder**: this entity must be added to `PLATFORM_ENTITIES` (`./index.ts`) or every
 * repository built against it throws TypeORM's `EntityMetadataNotFoundError` against a real
 * `DataSource` despite passing mocked unit tests.
 */
@Entity({ name: 'tenant_work_hint' })
export class TenantWorkHintEntity {
  @PrimaryColumn({ name: 'tenant_id', type: 'char', length: 36 })
  tenantId!: string;

  @PrimaryColumn({ type: 'enum', enum: ['pdf_session', 'outbox', 'attempt_timeout'] })
  kind!: TenantWorkHintKind;

  @Column({ name: 'pending_since', type: 'datetime', precision: 3 })
  pendingSince!: Date;
}
