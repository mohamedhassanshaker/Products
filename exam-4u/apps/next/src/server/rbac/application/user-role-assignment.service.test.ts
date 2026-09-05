import { describe, expect, it, vi } from 'vitest';
import { UserRoleAssignmentService } from './user-role-assignment.service';
import { LastAdminProtectedError, RoleNotFoundError } from '../domain/errors';
import type { RoleRepository } from '../infrastructure/role.repository';
import type { UserRoleRepository } from '../infrastructure/user-role.repository';
import type { RoleEntity } from '@/server/infrastructure/database';

const ADMIN_ROLE = { id: 1, name: 'Tenant Admin', description: null, isSystem: true, permissions: [], createdAt: new Date() } as RoleEntity;
const MEMBER_ROLE = { id: 2, name: 'Member', description: null, isSystem: true, permissions: [], createdAt: new Date() } as RoleEntity;

function fakeRoleRepo(rows: RoleEntity[]): RoleRepository {
  return {
    findByName: async (name: string) => rows.find((r) => r.name === name) ?? null,
    findById: async (id: number) => rows.find((r) => r.id === id) ?? null,
  } as unknown as RoleRepository;
}

describe('UserRoleAssignmentService', () => {
  it('rejects demoting the sole Tenant Admin', async () => {
    const userRoles: Pick<UserRoleRepository, 'findRoleIdsForUser' | 'findUserIdsForRole' | 'replaceRolesForUser'> = {
      findRoleIdsForUser: vi.fn().mockResolvedValue([ADMIN_ROLE.id]),
      findUserIdsForRole: vi.fn().mockResolvedValue(['user-1']), // only user-1 holds it
      replaceRolesForUser: vi.fn(),
    };
    const service = new UserRoleAssignmentService(fakeRoleRepo([ADMIN_ROLE, MEMBER_ROLE]), userRoles as UserRoleRepository);

    await expect(service.replaceRolesForUser('user-1', [MEMBER_ROLE.id])).rejects.toThrow(LastAdminProtectedError);
    expect(userRoles.replaceRolesForUser).not.toHaveBeenCalled();
  });

  it('rejects replacing with an empty role set for the sole Tenant Admin', async () => {
    const userRoles: Pick<UserRoleRepository, 'findRoleIdsForUser' | 'findUserIdsForRole' | 'replaceRolesForUser'> = {
      findRoleIdsForUser: vi.fn().mockResolvedValue([ADMIN_ROLE.id]),
      findUserIdsForRole: vi.fn().mockResolvedValue(['user-1']),
      replaceRolesForUser: vi.fn(),
    };
    const service = new UserRoleAssignmentService(fakeRoleRepo([ADMIN_ROLE]), userRoles as UserRoleRepository);

    await expect(service.replaceRolesForUser('user-1', [])).rejects.toThrow(LastAdminProtectedError);
    expect(userRoles.replaceRolesForUser).not.toHaveBeenCalled();
  });

  it('allows demoting an admin when a second Tenant Admin exists', async () => {
    const userRoles: Pick<UserRoleRepository, 'findRoleIdsForUser' | 'findUserIdsForRole' | 'replaceRolesForUser'> = {
      findRoleIdsForUser: vi.fn().mockResolvedValue([ADMIN_ROLE.id]),
      findUserIdsForRole: vi.fn().mockResolvedValue(['user-1', 'user-2']), // second admin exists
      replaceRolesForUser: vi.fn(),
    };
    const service = new UserRoleAssignmentService(fakeRoleRepo([ADMIN_ROLE, MEMBER_ROLE]), userRoles as UserRoleRepository);

    await expect(service.replaceRolesForUser('user-1', [MEMBER_ROLE.id])).resolves.toBeUndefined();
    expect(userRoles.replaceRolesForUser).toHaveBeenCalledWith('user-1', [MEMBER_ROLE.id]);
  });

  it('rejects an unknown role id — the whole call is rejected, no write occurs', async () => {
    const userRoles: Pick<UserRoleRepository, 'findRoleIdsForUser' | 'findUserIdsForRole' | 'replaceRolesForUser'> = {
      findRoleIdsForUser: vi.fn().mockResolvedValue([]),
      findUserIdsForRole: vi.fn(),
      replaceRolesForUser: vi.fn(),
    };
    const service = new UserRoleAssignmentService(fakeRoleRepo([]), userRoles as UserRoleRepository);

    await expect(service.replaceRolesForUser('user-1', [999])).rejects.toThrow(RoleNotFoundError);
    expect(userRoles.replaceRolesForUser).not.toHaveBeenCalled();
  });

  it('de-duplicates the input role id list', async () => {
    const userRoles: Pick<UserRoleRepository, 'findRoleIdsForUser' | 'findUserIdsForRole' | 'replaceRolesForUser'> = {
      findRoleIdsForUser: vi.fn().mockResolvedValue([]),
      findUserIdsForRole: vi.fn(),
      replaceRolesForUser: vi.fn(),
    };
    const service = new UserRoleAssignmentService(fakeRoleRepo([MEMBER_ROLE]), userRoles as UserRoleRepository);

    await service.replaceRolesForUser('user-1', [MEMBER_ROLE.id, MEMBER_ROLE.id]);
    expect(userRoles.replaceRolesForUser).toHaveBeenCalledWith('user-1', [MEMBER_ROLE.id]);
  });

  it('assertUserDeletable rejects deleting the sole Tenant Admin', async () => {
    const userRoles: Pick<UserRoleRepository, 'findRoleIdsForUser' | 'findUserIdsForRole'> = {
      findRoleIdsForUser: vi.fn().mockResolvedValue([ADMIN_ROLE.id]),
      findUserIdsForRole: vi.fn().mockResolvedValue(['user-1']),
    };
    const service = new UserRoleAssignmentService(fakeRoleRepo([ADMIN_ROLE]), userRoles as UserRoleRepository);
    await expect(service.assertUserDeletable('user-1')).rejects.toThrow(LastAdminProtectedError);
  });

  it('assertUserDeletable resolves for a non-admin user', async () => {
    const userRoles: Pick<UserRoleRepository, 'findRoleIdsForUser' | 'findUserIdsForRole'> = {
      findRoleIdsForUser: vi.fn().mockResolvedValue([MEMBER_ROLE.id]),
      findUserIdsForRole: vi.fn(),
    };
    const service = new UserRoleAssignmentService(fakeRoleRepo([ADMIN_ROLE, MEMBER_ROLE]), userRoles as UserRoleRepository);
    await expect(service.assertUserDeletable('user-1')).resolves.toBeUndefined();
  });
});
