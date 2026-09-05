import { describe, expect, it, vi } from 'vitest';
import { runWithRequestContext } from '@/server/context';
import { PermissionResolutionService } from './permission-resolution.service';
import type { UserRoleRepository } from '../infrastructure/user-role.repository';

function fakeUserRoles(names: string[]): Pick<UserRoleRepository, 'findEffectivePermissionNames'> {
  return { findEffectivePermissionNames: vi.fn().mockResolvedValue(names) };
}

describe('PermissionResolutionService — default-deny', () => {
  it('resolves to an empty Set (never throws, never defaults to allow) for a user with zero role grants', async () => {
    const service = new PermissionResolutionService(fakeUserRoles([]) as UserRoleRepository);
    const permissions = await service.getEffectivePermissions('user-with-no-roles');
    expect(permissions.size).toBe(0);
    expect(permissions instanceof Set).toBe(true);
  });

  it('resolves to an empty Set for a nonexistent/stale user id identically to zero roles', async () => {
    const service = new PermissionResolutionService(fakeUserRoles([]) as UserRoleRepository);
    await expect(service.getEffectivePermissions('does-not-exist')).resolves.toEqual(new Set());
  });

  it('hasPermission() returns false for any permission when the set is empty', async () => {
    const service = new PermissionResolutionService(fakeUserRoles([]) as UserRoleRepository);
    expect(await service.hasPermission('user-1', 'roles.read')).toBe(false);
  });

  it('resolves the union of grants across every role the user holds (not intersection)', async () => {
    const service = new PermissionResolutionService(fakeUserRoles(['exams.read', 'billing.read']) as UserRoleRepository);
    const permissions = await service.getEffectivePermissions('user-1');
    expect(permissions.has('exams.read')).toBe(true);
    expect(permissions.has('billing.read')).toBe(true);
  });

  it('memoizes the resolved Set on the ALS request context — a second call within the same request does not re-query', async () => {
    const findEffectivePermissionNames = vi.fn().mockResolvedValue(['exams.read']);
    const service = new PermissionResolutionService({ findEffectivePermissionNames } as unknown as UserRoleRepository);

    await runWithRequestContext({ requestId: 'r1' }, async () => {
      const first = await service.getEffectivePermissions('user-1');
      const second = await service.getEffectivePermissions('user-1');
      expect(first).toBe(second); // same Set instance
    });
    expect(findEffectivePermissionNames).toHaveBeenCalledTimes(1);
  });

  it('does not memoize across two separate request contexts', async () => {
    const findEffectivePermissionNames = vi.fn().mockResolvedValue(['exams.read']);
    const service = new PermissionResolutionService({ findEffectivePermissionNames } as unknown as UserRoleRepository);

    await runWithRequestContext({ requestId: 'r1' }, () => service.getEffectivePermissions('user-1'));
    await runWithRequestContext({ requestId: 'r2' }, () => service.getEffectivePermissions('user-1'));
    expect(findEffectivePermissionNames).toHaveBeenCalledTimes(2);
  });

  it('re-queries every call when invoked outside any request context (no memoization, still correct)', async () => {
    const findEffectivePermissionNames = vi.fn().mockResolvedValue(['exams.read']);
    const service = new PermissionResolutionService({ findEffectivePermissionNames } as unknown as UserRoleRepository);

    await service.getEffectivePermissions('user-1');
    await service.getEffectivePermissions('user-1');
    expect(findEffectivePermissionNames).toHaveBeenCalledTimes(2);
  });
});
