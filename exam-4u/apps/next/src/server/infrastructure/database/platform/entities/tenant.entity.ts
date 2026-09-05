import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { TenantStatus } from '@examland/contracts';

/**
 * TypeORM mapping for `platform.tenant` (LLD §4 DDL) — ported verbatim from
 * `legacy/api/src/infrastructure/database/platform/entities/tenant.entity.ts`. Lives under
 * `infrastructure/database/platform` — only the platform `DataSource` (never a tenant `DataSource`)
 * is ever built with this entity in its metadata, so an accidental tenant-schema query against this
 * table is structurally impossible.
 *
 * Includes every column the already-settled LLD DDL defines (branding: `logoUrl`/
 * `accentColorOverride`; AI assignment: `assignedAiModelId`) even though this dispatch's own scope
 * (tenant CRUD + provisioning) never reads/writes the branding or AI-assignment fields — see
 * `docs/plans/nextjs-rewrite-phase1-plan.md`'s "Decisions made" for why the full column set is
 * created now (avoids a later reshaping migration) while the read/write *logic* for those fields
 * stays deferred to the phases that actually own them (branding: Phase 9; AI assignment: Phase 5).
 */
@Entity({ name: 'tenant' })
export class TenantEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ name: 'subdomain_slug', type: 'varchar', length: 63 })
  subdomainSlug!: string;

  /** Deterministic, generated once at provisioning time, immutable thereafter (HLD §4.1). */
  @Column({ name: 'schema_name', type: 'varchar', length: 64 })
  schemaName!: string;

  @Column({ type: 'enum', enum: ['Provisioning', 'Active', 'Suspended', 'Failed'], default: 'Provisioning' })
  status!: TenantStatus;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ name: 'allow_email_registration', type: 'boolean', default: true })
  allowEmailRegistration!: boolean;

  @Column({ name: 'allow_google_sign_in', type: 'boolean', default: false })
  allowGoogleSignIn!: boolean;

  @Column({ name: 'default_self_register_role', type: 'varchar', length: 100, nullable: true })
  defaultSelfRegisterRole!: string | null;

  @Column({ name: 'logo_url', type: 'varchar', length: 1024, nullable: true })
  logoUrl!: string | null;

  /** FR-MT-10 (Phase 9 read/write logic; column only this dispatch): nullable 6-digit hex (no
   * leading `#`, uppercase). `NULL` means the platform default accent applies. */
  @Column({ name: 'accent_color_override', type: 'char', length: 6, nullable: true })
  accentColorOverride!: string | null;

  @Column({ name: 'provisioning_error', type: 'text', nullable: true })
  provisioningError!: string | null;

  @Column({ name: 'provisioning_heartbeat_at', type: 'datetime', precision: 3, nullable: true })
  provisioningHeartbeatAt!: Date | null;

  /** The first Tenant Admin's invited email address (FR-MT-4), persisted at tenant-creation time so a
   * later `retry` re-run of `seed_admin_user` knows which address to seed without the caller
   * resupplying it. */
  @Column({ name: 'pending_admin_email', type: 'varchar', length: 320, nullable: true })
  pendingAdminEmail!: string | null;

  /** FR-AI-3 (Phase 5 read/write logic; column only this dispatch, no FK yet — `approved_ai_model`
   * doesn't exist until Phase 5's own migration, a documented forward reference matching this app's
   * `user.education_level_id`-style precedent from `CreateRbacTables`). `NULL` ⇒ resolves to the
   * current platform default. */
  @Column({ name: 'assigned_ai_model_id', type: 'char', length: 36, nullable: true })
  assignedAiModelId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;

  @Column({ name: 'deleted_at', type: 'datetime', precision: 3, nullable: true })
  deletedAt!: Date | null;

  @Column({ name: 'purge_after_at', type: 'datetime', precision: 3, nullable: true })
  purgeAfterAt!: Date | null;
}
