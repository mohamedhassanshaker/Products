import { describe, expect, it, vi } from 'vitest';
import { UsersService } from './users.service';
import { AdminEmailAlreadyRegisteredError, AdminWeakPasswordError, UserNotFoundError } from '../domain/errors';
import type { UserAdminRepository } from '../infrastructure/user-admin.repository';
import type { RoleRepository, UserRoleRepository, UserRoleAssignmentService } from '@/server/rbac';
import type { PasswordHasherPort } from '@/server/common/ports/password-hasher.port';
import type { UserEntity } from '@/server/infrastructure/database';

const PASSWORD_POLICY = { minLength: 8, requireUpper: true, requireLower: true, requireDigit: true, requireSymbol: false };

function baseUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: 'u1',
    email: 'a@b.com',
    firstName: 'A',
    lastName: 'B',
    passwordHash: 'hash',
    phone: null,
    occupation: null,
    companyName: null,
    country: null,
    educationLevelId: null,
    pic: null,
    isActive: true,
    passwordResetTokenHash: null,
    passwordResetTokenExpiry: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
    ...overrides,
  } as UserEntity;
}

function fakeUsersRepo(seed: UserEntity[] = []): UserAdminRepository {
  const rows = [...seed];
  return {
    findById: vi.fn(async (id: string) => rows.find((r) => r.id === id) ?? null),
    findByEmail: vi.fn(async (email: string) => rows.find((r) => r.email === email) ?? null),
    findByIds: vi.fn(async (ids: string[]) => rows.filter((r) => ids.includes(r.id))),
    insert: vi.fn(async (data: Partial<UserEntity>) => {
      const created = baseUser({ ...data, id: data.id ?? 'generated' });
      rows.push(created);
      return created;
    }),
    update: vi.fn(async (id: string, data: Partial<UserEntity>) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...data };
    }),
    delete: vi.fn(async (id: string) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx >= 0) rows.splice(idx, 1);
    }),
    findMany: vi.fn(async () => ({ items: rows, total: rows.length })),
  } as unknown as UserAdminRepository;
}

function fakeRoleRepo(): RoleRepository {
  return { findById: vi.fn(async (id: number) => ({ id, name: 'Member', isSystem: true })) } as unknown as RoleRepository;
}

function fakeUserRoleRepo(grants: Map<string, number[]> = new Map()): UserRoleRepository {
  return { findRoleIdsForUser: vi.fn(async (userId: string) => grants.get(userId) ?? []) } as unknown as UserRoleRepository;
}

function fakeAssignment(): UserRoleAssignmentService {
  return {
    replaceRolesForUser: vi.fn(async () => undefined),
    assertUserDeletable: vi.fn(async () => undefined),
  } as unknown as UserRoleAssignmentService;
}

function fakeHasher(): PasswordHasherPort {
  return { hash: vi.fn(async (p: string) => `hashed:${p}`), compare: vi.fn(async () => true) };
}

describe('UsersService.create', () => {
  it('rejects a duplicate email', async () => {
    const users = fakeUsersRepo([baseUser({ email: 'dup@b.com' })]);
    const service = new UsersService(PASSWORD_POLICY, users, fakeRoleRepo(), fakeUserRoleRepo(), fakeAssignment(), fakeHasher());
    await expect(service.create({ email: 'dup@b.com', firstName: 'X', lastName: 'Y' })).rejects.toThrow(
      AdminEmailAlreadyRegisteredError,
    );
  });

  it('rejects an admin-supplied weak password', async () => {
    const users = fakeUsersRepo();
    const service = new UsersService(PASSWORD_POLICY, users, fakeRoleRepo(), fakeUserRoleRepo(), fakeAssignment(), fakeHasher());
    await expect(service.create({ email: 'new@b.com', firstName: 'X', lastName: 'Y', password: 'short' })).rejects.toThrow(
      AdminWeakPasswordError,
    );
  });

  it('generates a random temporary password when none is supplied, returned exactly once', async () => {
    const users = fakeUsersRepo();
    const service = new UsersService(PASSWORD_POLICY, users, fakeRoleRepo(), fakeUserRoleRepo(), fakeAssignment(), fakeHasher());
    const result = await service.create({ email: 'new@b.com', firstName: 'X', lastName: 'Y' });
    expect(result.temporaryPassword).toBeDefined();
    expect(result.temporaryPassword!.length).toBeGreaterThanOrEqual(32);
  });

  it('never returns a temporaryPassword when the admin supplied one', async () => {
    const users = fakeUsersRepo();
    const service = new UsersService(PASSWORD_POLICY, users, fakeRoleRepo(), fakeUserRoleRepo(), fakeAssignment(), fakeHasher());
    const result = await service.create({ email: 'new@b.com', firstName: 'X', lastName: 'Y', password: 'Abcdefg1' });
    expect(result.temporaryPassword).toBeUndefined();
  });

  it('assigns initial roles when roleIds is provided', async () => {
    const users = fakeUsersRepo();
    const assignment = fakeAssignment();
    const service = new UsersService(PASSWORD_POLICY, users, fakeRoleRepo(), fakeUserRoleRepo(), assignment, fakeHasher());
    await service.create({ email: 'new@b.com', firstName: 'X', lastName: 'Y', password: 'Abcdefg1', roleIds: [1, 2] });
    expect(assignment.replaceRolesForUser).toHaveBeenCalledWith(expect.any(String), [1, 2]);
  });

  it('normalizes (trims/lowercases) the email before uniqueness-checking and persisting', async () => {
    const users = fakeUsersRepo();
    const service = new UsersService(PASSWORD_POLICY, users, fakeRoleRepo(), fakeUserRoleRepo(), fakeAssignment(), fakeHasher());
    await service.create({ email: '  NEW@B.com  ', firstName: 'X', lastName: 'Y', password: 'Abcdefg1' });
    expect(users.insert).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@b.com' }));
  });
});

describe('UsersService.get/update/delete', () => {
  it('get() throws UserNotFoundError for an unknown id', async () => {
    const service = new UsersService(PASSWORD_POLICY, fakeUsersRepo(), fakeRoleRepo(), fakeUserRoleRepo(), fakeAssignment(), fakeHasher());
    await expect(service.get('missing')).rejects.toThrow(UserNotFoundError);
  });

  it('update() applies only the provided fields and never touches email/password', async () => {
    const users = fakeUsersRepo([baseUser()]);
    const service = new UsersService(PASSWORD_POLICY, users, fakeRoleRepo(), fakeUserRoleRepo(), fakeAssignment(), fakeHasher());
    const updated = await service.update('u1', { firstName: 'New', isActive: false });
    expect(updated.firstName).toBe('New');
    expect(updated.isActive).toBe(false);
    expect(users.update).toHaveBeenCalledWith('u1', { firstName: 'New', isActive: false });
  });

  it('update() throws UserNotFoundError for an unknown id', async () => {
    const service = new UsersService(PASSWORD_POLICY, fakeUsersRepo(), fakeRoleRepo(), fakeUserRoleRepo(), fakeAssignment(), fakeHasher());
    await expect(service.update('missing', { firstName: 'X' })).rejects.toThrow(UserNotFoundError);
  });

  it('delete() checks last-admin-protection before hard-deleting', async () => {
    const users = fakeUsersRepo([baseUser()]);
    const assignment = fakeAssignment();
    const service = new UsersService(PASSWORD_POLICY, users, fakeRoleRepo(), fakeUserRoleRepo(), assignment, fakeHasher());
    await service.delete('u1');
    expect(assignment.assertUserDeletable).toHaveBeenCalledWith('u1');
    expect(users.delete).toHaveBeenCalledWith('u1');
  });

  it('delete() throws UserNotFoundError for an unknown id (never reaches the last-admin check)', async () => {
    const assignment = fakeAssignment();
    const service = new UsersService(PASSWORD_POLICY, fakeUsersRepo(), fakeRoleRepo(), fakeUserRoleRepo(), assignment, fakeHasher());
    await expect(service.delete('missing')).rejects.toThrow(UserNotFoundError);
    expect(assignment.assertUserDeletable).not.toHaveBeenCalled();
  });
});

describe('UsersService.list', () => {
  it('hydrates each row with its resolved role summaries', async () => {
    const users = fakeUsersRepo([baseUser({ id: 'u1' })]);
    const userRoles = fakeUserRoleRepo(new Map([['u1', [7]]]));
    const service = new UsersService(PASSWORD_POLICY, users, fakeRoleRepo(), userRoles, fakeAssignment(), fakeHasher());
    const { items, total } = await service.list({});
    expect(total).toBe(1);
    expect(items[0].roles).toEqual([{ id: 7, name: 'Member', isSystem: true }]);
  });
});

describe('UsersService.replaceRoles', () => {
  it('delegates to UserRoleAssignmentService and returns the refreshed summary', async () => {
    const users = fakeUsersRepo([baseUser()]);
    const assignment = fakeAssignment();
    const service = new UsersService(PASSWORD_POLICY, users, fakeRoleRepo(), fakeUserRoleRepo(), assignment, fakeHasher());
    await service.replaceRoles('u1', [3]);
    expect(assignment.replaceRolesForUser).toHaveBeenCalledWith('u1', [3]);
  });

  it('throws UserNotFoundError for an unknown id', async () => {
    const service = new UsersService(PASSWORD_POLICY, fakeUsersRepo(), fakeRoleRepo(), fakeUserRoleRepo(), fakeAssignment(), fakeHasher());
    await expect(service.replaceRoles('missing', [1])).rejects.toThrow(UserNotFoundError);
  });
});
