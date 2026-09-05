import { Column, CreateDateColumn, Entity, JoinTable, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';
import { PermissionEntity } from './permission.entity';

/**
 * TypeORM mapping for the tenant-schema `role` table (created by
 * `migrations/tenant/20260815000001-create-rbac-tables.ts`) — ported verbatim from
 * `legacy/api/src/modules/rbac/infrastructure/entities/role.entity.ts`. `isSystem` marks the two
 * provisioning-seeded roles (`Tenant Admin`, `Member`) — protected against rename/delete (never
 * against permission-grant changes) by `RolesService`.
 */
@Entity({ name: 'role' })
export class RoleEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  description!: string | null;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  /** Eager: false (ported verbatim) — callers that need grants explicitly load the `permissions`
   * relation (`RoleRepository.findById`/`findAll`), so a plain `findOne` elsewhere never pays for an
   * unwanted join. */
  @ManyToMany(() => PermissionEntity, { eager: false })
  @JoinTable({
    name: 'role_permission',
    joinColumn: { name: 'role_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  permissions!: PermissionEntity[];
}
