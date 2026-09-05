import { describe, expect, it } from 'vitest';
import { RolesService } from './roles.service';
import { PermissionNotFoundError, RoleInUseError, RoleNameExistsError, RoleNotFoundError, SystemRoleProtectedError } from '../domain/errors';
import type { RoleRepository } from '../infrastructure/role.repository';
import type { PermissionRepository } from '../infrastructure/permission.repository';
import type { UserRoleRepository } from '../infrastructure/user-role.repository';
import type { PermissionEntity, RoleEntity } from '@/server/infrastructure/database';

/** In-memory fakes — real behavior (not `vi.fn()` mocks-of-nothing), so the service's actual
 * business rules are exercised end to end. */
function fakePermissionRepo(permissions: PermissionEntity[]): PermissionRepository {
  return {
    findAll: async () => permissions,
    findById: async (id: number) => permissions.find((p) => p.id === id) ?? null,
    findByIds: async (ids: number[]) => permissions.filter((p) => ids.includes(p.id)),
    isReferencedByAnyRole: async () => false,
    delete: async () => undefined,
  } as unknown as PermissionRepository;
}

function fakeRoleRepo(seed: RoleEntity[] = []): RoleRepository {
  const rows = [...seed];
  let nextId = Math.max(0, ...rows.map((r) => r.id)) + 1;
  return {
    findAll: async () => rows,
    findById: async (id: number) => rows.find((r) => r.id === id) ?? null,
    findByName: async (name: string) => rows.find((r) => r.name === name) ?? null,
    existsByName: async (name: string) => rows.some((r) => r.name === name),
    create: (data: Partial<RoleEntity>) => ({ id: nextId, name: '', description: null, isSystem: false, permissions: [], createdAt: new Date(), ...data }) as RoleEntity,
    save: async (role: RoleEntity) => {
      if (!rows.some((r) => r.id === role.id)) {
        role.id = role.id || nextId++;
        rows.push(role);
      } else {
        const idx = rows.findIndex((r) => r.id === role.id);
        rows[idx] = role;
      }
      return role;
    },
    delete: async (id: number) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx >= 0) rows.splice(idx, 1);
    },
  } as unknown as RoleRepository;
}

function fakeUserRoleRepo(referenced: Set<number> = new Set()): UserRoleRepository {
  return {
    isRoleReferenced: async (roleId: number) => referenced.has(roleId),
  } as unknown as UserRoleRepository;
}

const EXAMS_READ: PermissionEntity = { id: 1, name: 'exams.read', description: null, group: 'Exams', createdAt: new Date() };
const ROLES_READ: PermissionEntity = { id: 2, name: 'roles.read', description: null, group: 'Roles', createdAt: new Date() };

describe('RolesService', () => {
  it('creates a role and resolves its granted permissions', async () => {
    const service = new RolesService(fakeRoleRepo(), fakePermissionRepo([EXAMS_READ, ROLES_READ]), fakeUserRoleRepo());
    const created = await service.create({ name: 'Custom', permissionIds: [1] });
    expect(created.name).toBe('Custom');
    expect(created.isSystem).toBe(false);
    expect(created.permissions.map((p) => p.name)).toEqual(['exams.read']);
  });

  it('rejects creating a role with a duplicate name', async () => {
    const existing = { id: 1, name: 'Custom', description: null, isSystem: false, permissions: [], createdAt: new Date() } as RoleEntity;
    const service = new RolesService(fakeRoleRepo([existing]), fakePermissionRepo([]), fakeUserRoleRepo());
    await expect(service.create({ name: 'Custom' })).rejects.toThrow(RoleNameExistsError);
  });

  it('rejects creating a role with an unknown permission id — the whole create is rejected', async () => {
    const service = new RolesService(fakeRoleRepo(), fakePermissionRepo([EXAMS_READ]), fakeUserRoleRepo());
    await expect(service.create({ name: 'Custom', permissionIds: [999] })).rejects.toThrow(PermissionNotFoundError);
  });

  it('get() throws RoleNotFoundError for an unknown id', async () => {
    const service = new RolesService(fakeRoleRepo(), fakePermissionRepo([]), fakeUserRoleRepo());
    await expect(service.get(999)).rejects.toThrow(RoleNotFoundError);
  });

  it('rejects renaming a system role', async () => {
    const admin = { id: 1, name: 'Tenant Admin', description: null, isSystem: true, permissions: [], createdAt: new Date() } as RoleEntity;
    const service = new RolesService(fakeRoleRepo([admin]), fakePermissionRepo([]), fakeUserRoleRepo());
    await expect(service.update(1, { name: 'Renamed' })).rejects.toThrow(SystemRoleProtectedError);
  });

  it('allows a no-op rename (same name, re-trimmed) on a system role without a uniqueness re-check', async () => {
    const admin = { id: 1, name: 'Tenant Admin', description: null, isSystem: true, permissions: [], createdAt: new Date() } as RoleEntity;
    const service = new RolesService(fakeRoleRepo([admin]), fakePermissionRepo([]), fakeUserRoleRepo());
    await expect(service.update(1, { name: ' Tenant Admin ' })).resolves.toMatchObject({ name: 'Tenant Admin' });
  });

  it('allows editing a system role\'s description', async () => {
    const admin = { id: 1, name: 'Tenant Admin', description: null, isSystem: true, permissions: [], createdAt: new Date() } as RoleEntity;
    const service = new RolesService(fakeRoleRepo([admin]), fakePermissionRepo([]), fakeUserRoleRepo());
    await expect(service.update(1, { description: 'Updated' })).resolves.toMatchObject({ description: 'Updated' });
  });

  it('allows replacing a system role\'s permission grants', async () => {
    const admin = { id: 1, name: 'Tenant Admin', description: null, isSystem: true, permissions: [], createdAt: new Date() } as RoleEntity;
    const service = new RolesService(fakeRoleRepo([admin]), fakePermissionRepo([EXAMS_READ]), fakeUserRoleRepo());
    const updated = await service.replacePermissions(1, [1]);
    expect(updated.permissions.map((p) => p.name)).toEqual(['exams.read']);
  });

  it('rejects deleting a system role even when unreferenced by any user', async () => {
    const admin = { id: 1, name: 'Tenant Admin', description: null, isSystem: true, permissions: [], createdAt: new Date() } as RoleEntity;
    const service = new RolesService(fakeRoleRepo([admin]), fakePermissionRepo([]), fakeUserRoleRepo(new Set()));
    await expect(service.delete(1)).rejects.toThrow(SystemRoleProtectedError);
  });

  it('rejects deleting a non-system role still referenced by a user', async () => {
    const custom = { id: 5, name: 'Custom', description: null, isSystem: false, permissions: [], createdAt: new Date() } as RoleEntity;
    const service = new RolesService(fakeRoleRepo([custom]), fakePermissionRepo([]), fakeUserRoleRepo(new Set([5])));
    await expect(service.delete(5)).rejects.toThrow(RoleInUseError);
  });

  it('deletes a non-system, unreferenced role', async () => {
    const custom = { id: 5, name: 'Custom', description: null, isSystem: false, permissions: [], createdAt: new Date() } as RoleEntity;
    const service = new RolesService(fakeRoleRepo([custom]), fakePermissionRepo([]), fakeUserRoleRepo(new Set()));
    await service.delete(5);
    await expect(service.get(5)).rejects.toThrow(RoleNotFoundError);
  });
});
