import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * TypeORM mapping for `platform.platform_admin` (created by
 * `migrations/platform/20260815000008-create-platform-admin-table.ts`, Phase 1 sub-slice 1b) —
 * ported verbatim from `legacy/api/src/infrastructure/database/platform/entities/
 * platform-admin.entity.ts`. Lives under `infrastructure/database/platform` (never a tenant
 * `DataSource`'s entity metadata) — deliberately structurally separate from the tenant-schema
 * `UserEntity`: a Platform Admin has no tenant, no roles/permissions row, and is never resolvable
 * through any tenant `DataSource`.
 */
@Entity({ name: 'platform_admin' })
export class PlatformAdminEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 100 })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'last_login_at', type: 'datetime', precision: 3, nullable: true })
  lastLoginAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
