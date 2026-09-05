import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `idempotency_key` table (LLD §4 DDL, FR-PDF-10). Migration plan
 * Phase 6, sub-slice "6c" — deliberately deferred by sub-slice "6a" (see that sub-slice's own "Decisions
 * made" #2) until `AppendExamService`'s `Idempotency-Key` header handling — its only real writer —
 * actually existed. Ported from
 * `legacy/api/src/modules/pdf-processing/infrastructure/entities/idempotency-key.entity.ts`.
 *
 * Composite primary key `(scope, key)` — `scope` is kept even though `'pdf-append'` is the only scope
 * this sub-slice writes, so a future feature needing its own idempotency scope never needs a schema
 * change, only a new scope-name constant.
 */
@Entity({ name: 'idempotency_key' })
export class IdempotencyKeyEntity {
  @PrimaryColumn({ name: 'key', type: 'varchar', length: 120 })
  key!: string;

  @PrimaryColumn({ type: 'varchar', length: 60 })
  scope!: string;

  @Column({ name: 'response_hash', type: 'char', length: 64, nullable: true })
  responseHash!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
