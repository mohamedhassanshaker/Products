import { describe, expect, it, vi } from 'vitest';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { PlatformInvalidCredentialsError } from '../domain/errors';
import type { PlatformAdminRepository } from '../infrastructure/platform-admin.repository';
import type { PlatformAdminTokenPort } from '../domain/ports/platform-admin-token.port';
import type { PlatformAdminEntity } from '@/server/infrastructure/database';

function fakeHasher() {
  return {
    hash: vi.fn(async (plain: string) => `hashed:${plain}`),
    compare: vi.fn(async (plain: string, hash: string) => hash === `hashed:${plain}`),
  };
}

function fakeTokens(): PlatformAdminTokenPort {
  return {
    issue: vi.fn(async (claims) => ({ token: `token-for-${claims.adminId}`, expiresInSeconds: 3600 })),
    verify: vi.fn(async () => null),
  };
}

function fakeAdminRepo(admins: Partial<PlatformAdminEntity>[]): PlatformAdminRepository {
  const rows: PlatformAdminEntity[] = admins.map((a) => ({
    id: a.id ?? 'id',
    email: a.email ?? '',
    passwordHash: a.passwordHash ?? 'x',
    name: a.name ?? 'Platform Admin',
    isActive: a.isActive ?? true,
    lastLoginAt: a.lastLoginAt ?? null,
    createdAt: a.createdAt ?? new Date(),
  }));
  return {
    findByEmail: async (email: string) => rows.find((r) => r.email === email.trim().toLowerCase()) ?? null,
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    updateLastLogin: async (id: string, when: Date) => {
      const row = rows.find((r) => r.id === id);
      if (row) row.lastLoginAt = when;
    },
  } as unknown as PlatformAdminRepository;
}

describe('PlatformAdminAuthService.login — enumeration safety', () => {
  it('issues a token for correct credentials', async () => {
    const admins = fakeAdminRepo([{ id: 'a1', email: 'admin@example.com', passwordHash: 'hashed:Correct1', isActive: true }]);
    const service = new PlatformAdminAuthService(admins, fakeHasher(), fakeTokens());
    const result = await service.login({ email: 'admin@example.com', password: 'Correct1' });
    expect(result.accessToken).toBe('token-for-a1');
  });

  it('rejects an unknown email', async () => {
    const service = new PlatformAdminAuthService(fakeAdminRepo([]), fakeHasher(), fakeTokens());
    await expect(service.login({ email: 'ghost@example.com', password: 'anything' })).rejects.toThrow(PlatformInvalidCredentialsError);
  });

  it('rejects a wrong password', async () => {
    const admins = fakeAdminRepo([{ id: 'a1', email: 'admin@example.com', passwordHash: 'hashed:Correct1', isActive: true }]);
    const service = new PlatformAdminAuthService(admins, fakeHasher(), fakeTokens());
    await expect(service.login({ email: 'admin@example.com', password: 'Wrong1' })).rejects.toThrow(PlatformInvalidCredentialsError);
  });

  it('rejects a correct password for a deactivated admin with the IDENTICAL error (not a distinct code) — unlike the tenant realm', async () => {
    const admins = fakeAdminRepo([{ id: 'a1', email: 'admin@example.com', passwordHash: 'hashed:Correct1', isActive: false }]);
    const service = new PlatformAdminAuthService(admins, fakeHasher(), fakeTokens());
    await expect(service.login({ email: 'admin@example.com', password: 'Correct1' })).rejects.toThrow(PlatformInvalidCredentialsError);
  });

  it('always calls the hasher, even for an unknown email (dummy-hash timing-equalization) with the platform-specific literal', async () => {
    const hasher = fakeHasher();
    const service = new PlatformAdminAuthService(fakeAdminRepo([]), hasher, fakeTokens());
    await expect(service.login({ email: 'ghost@example.com', password: 'anything' })).rejects.toThrow(PlatformInvalidCredentialsError);
    expect(hasher.hash).toHaveBeenCalledWith('el-platform-enumeration-safety-dummy-password');
  });

  it('getById returns null (not a throw) for an unknown id', async () => {
    const service = new PlatformAdminAuthService(fakeAdminRepo([]), fakeHasher(), fakeTokens());
    await expect(service.getById('nope')).resolves.toBeNull();
  });

  it('getById returns the summary for a real admin', async () => {
    const admins = fakeAdminRepo([{ id: 'a1', email: 'admin@example.com', name: 'Root Admin' }]);
    const service = new PlatformAdminAuthService(admins, fakeHasher(), fakeTokens());
    await expect(service.getById('a1')).resolves.toMatchObject({ id: 'a1', email: 'admin@example.com', name: 'Root Admin' });
  });
});
