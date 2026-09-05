import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { PlatformAdminBootstrapService } from './platform-admin-bootstrap.service';
import type { PlatformAdminRepository } from '../infrastructure/platform-admin.repository';

const silentLogger = pino({ level: 'silent' });

function fakeRepo(count: number) {
  return {
    count: vi.fn().mockResolvedValue(count),
    insert: vi.fn().mockResolvedValue(undefined),
  };
}

describe('PlatformAdminBootstrapService', () => {
  it('seeds a Platform Admin when the table is completely empty and both env vars are set', async () => {
    const repo = fakeRepo(0);
    const hasher = { hash: vi.fn().mockResolvedValue('hashed-password'), compare: vi.fn() };
    const service = new PlatformAdminBootstrapService(repo as unknown as PlatformAdminRepository, hasher, silentLogger);

    await service.run({ email: 'Admin@Example.com', password: 'ExamlandAdmin1' });

    expect(repo.insert).toHaveBeenCalledTimes(1);
    const inserted = repo.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({ email: 'admin@example.com', name: 'Platform Admin', isActive: true, lastLoginAt: null, passwordHash: 'hashed-password' });
    expect(hasher.hash).toHaveBeenCalledWith('ExamlandAdmin1');
  });

  it('no-ops when the table already has at least one admin, even with both env vars set', async () => {
    const repo = fakeRepo(1);
    const hasher = { hash: vi.fn(), compare: vi.fn() };
    const service = new PlatformAdminBootstrapService(repo as unknown as PlatformAdminRepository, hasher, silentLogger);

    await service.run({ email: 'admin@example.com', password: 'ExamlandAdmin1' });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('no-ops when only the email is set', async () => {
    const repo = fakeRepo(0);
    const hasher = { hash: vi.fn(), compare: vi.fn() };
    const service = new PlatformAdminBootstrapService(repo as unknown as PlatformAdminRepository, hasher, silentLogger);

    await service.run({ email: 'admin@example.com', password: undefined });
    expect(repo.insert).not.toHaveBeenCalled();
    expect(repo.count).not.toHaveBeenCalled();
  });

  it('no-ops when only the password is set', async () => {
    const repo = fakeRepo(0);
    const hasher = { hash: vi.fn(), compare: vi.fn() };
    const service = new PlatformAdminBootstrapService(repo as unknown as PlatformAdminRepository, hasher, silentLogger);

    await service.run({ email: undefined, password: 'ExamlandAdmin1' });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('no-ops when neither env var is set', async () => {
    const repo = fakeRepo(0);
    const hasher = { hash: vi.fn(), compare: vi.fn() };
    const service = new PlatformAdminBootstrapService(repo as unknown as PlatformAdminRepository, hasher, silentLogger);

    await service.run({ email: undefined, password: undefined });
    expect(repo.insert).not.toHaveBeenCalled();
  });
});
