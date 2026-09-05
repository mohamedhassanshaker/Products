import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `permission` table (created by
 * `migrations/tenant/20260815000001-create-rbac-tables.ts`) — ported verbatim from
 * `legacy/api/src/modules/rbac/infrastructure/entities/permission.entity.ts`. Seeded once at
 * provisioning time by `SeedRbacStep` (sub-slice 1a); not tenant-editable — there is no create route
 * in this dispatch either, matching legacy's own identical-phase scope.
 */
@Entity({ name: 'permission' })
export class PermissionEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  description!: string | null;

  @Column({ name: 'group', type: 'varchar', length: 50 })
  group!: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
