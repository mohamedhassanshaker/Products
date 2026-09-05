import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * TypeORM mapping for `platform.approved_ai_model` (FR-AI-2) — ported verbatim from
 * `legacy/api/src/infrastructure/database/platform/entities/approved-ai-model.entity.ts`. The
 * platform-wide curated allowlist of OpenRouter model ids a Platform Admin may assign to a tenant
 * (FR-AI-3) — see `server/platform/ai-models`' `AiModelsService` for every mutation invariant and
 * `AiModelResolver` for how a tenant's effective model is derived from this table plus
 * `tenant.assigned_ai_model_id`.
 *
 * **Registration reminder** (the identical Dev-9a/Phase-1-QA lesson this app's `tenant.entity.ts` doc
 * comment already documents): this entity must be added to `PLATFORM_ENTITIES`
 * (`./index.ts`) or every repository built against it throws TypeORM's `EntityMetadataNotFoundError`
 * against a real `DataSource` despite passing mocked unit tests.
 */
@Entity({ name: 'approved_ai_model' })
export class ApprovedAiModelEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  /** `provider/model[:variant]` shape (e.g. `anthropic/claude-3.5-haiku`) — validated at the
   * `AiModelsService.approve` boundary, never re-validated here. */
  @Column({ name: 'open_router_model_id', type: 'varchar', length: 200 })
  openRouterModelId!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 200 })
  displayName!: string;

  /** A disabled model is hidden from *future* tenant assignment but a tenant already assigned to it
   * keeps using it unchanged (FR-AI-2) — `AiModelResolver` deliberately ignores this flag on an
   * explicit assignment, only consulting it for the platform-default fallback path. */
  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled!: boolean;

  /** Exactly one row has this `true` at all times once any row exists (`uq_aim_single_default` on the
   * DB side; `AiModelsService`'s transaction rules enforce "exactly one," which the DB alone cannot
   * guarantee "at least one" for). */
  @Column({ name: 'is_platform_default', type: 'boolean', default: false })
  isPlatformDefault!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;
}
