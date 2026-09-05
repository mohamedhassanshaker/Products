import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `user` table (created by
 * `migrations/tenant/20260815000001-create-rbac-tables.ts` — sub-slice 1a) — ported verbatim from
 * `legacy/api/src/modules/auth/infrastructure/entities/user.entity.ts`. Lives under
 * `infrastructure/database/tenant/entities` (not `server/auth`): only the tenant `DataSource`'s shared
 * entity metadata set (`TENANT_ENTITIES`) ever includes this class, mirroring `TenantEntity`'s own
 * "entity classes are shape/metadata, not the kind of implementation detail the barrel-only rule
 * exists to hide" precedent from sub-slice 1a.
 *
 * No dedicated Google-identity-linking column exists (no `google_id`/`google_sub`) — deliberately, per
 * this dispatch's research: Google sign-in resolves purely by matching `email` against this same
 * table; `passwordHash === null` is the only signal an account is Google-only/invited-not-activated.
 */
@Entity({ name: 'user' })
export class UserEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName!: string;

  @Column({ name: 'last_name', type: 'varchar', length: 100 })
  lastName!: string;

  /** `NULL` for an invited-but-not-yet-activated account (provisioning's `SeedAdminUserStep`) or a
   * Google-sign-in-only account (never a password login). */
  @Column({ name: 'password_hash', type: 'varchar', length: 100, nullable: true })
  passwordHash!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  occupation!: string | null;

  @Column({ name: 'company_name', type: 'varchar', length: 200, nullable: true })
  companyName!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country!: string | null;

  /** Forward reference — no FK yet (`education_level` doesn't exist until the Taxonomy phase, Phase
   * 3), matching `CreateRbacTables`' own documented forward-reference precedent. */
  @Column({ name: 'education_level_id', type: 'int', nullable: true })
  educationLevelId!: number | null;

  /** Avatar storage key (Phase 1c's `profile`/`files` modules own the read/write logic; column only
   * this dispatch, matching `TenantEntity`'s "column now, logic later" precedent). */
  @Column({ type: 'varchar', length: 512, nullable: true })
  pic!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'password_reset_token_hash', type: 'char', length: 64, nullable: true })
  passwordResetTokenHash!: string | null;

  @Column({ name: 'password_reset_token_expiry', type: 'datetime', precision: 3, nullable: true })
  passwordResetTokenExpiry!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;

  @Column({ name: 'last_login_at', type: 'datetime', precision: 3, nullable: true })
  lastLoginAt!: Date | null;
}
