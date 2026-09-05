import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runWithRequestContext } from '@/server/context';
import { NotFoundDomainError } from '@/server/common/errors/domain-error';
import { ProfileService } from './profile.service';
import { FileTooLargeError, UnsupportedImageTypeError } from '../domain/errors';
import type { ProfileRepository } from '../infrastructure/profile.repository';
import type { StoragePort } from '@/server/common/ports/storage.port';
import type { UserEntity } from '@/server/infrastructure/database';

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

function fakeProfilesRepo(seed?: UserEntity): ProfileRepository {
  let row: UserEntity | null = seed ?? null;
  return {
    findById: vi.fn(async () => row),
    updateFields: vi.fn(async (_id: string, fields: Partial<UserEntity>) => {
      if (row) row = { ...row, ...fields };
    }),
    setPicture: vi.fn(async (_id: string, key: string) => {
      if (row) row = { ...row, pic: key };
    }),
  } as unknown as ProfileRepository;
}

function fakeStorage(): StoragePort {
  return {
    put: vi.fn(async (key: string, data: Buffer) => ({ key, size: (data as Buffer).length })),
    getStream: vi.fn(),
    stat: vi.fn(),
    delete: vi.fn(),
    deletePrefix: vi.fn(),
    exists: vi.fn(),
  };
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('ProfileService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getProfile() throws NotFoundDomainError for a vanished user', async () => {
    const service = new ProfileService({ maxAvatarSizeBytes: 5_242_880 }, fakeProfilesRepo(), fakeStorage());
    await expect(service.getProfile('missing')).rejects.toThrow(NotFoundDomainError);
  });

  it('getProfile() returns the mapped summary, never including passwordHash', async () => {
    const service = new ProfileService({ maxAvatarSizeBytes: 5_242_880 }, fakeProfilesRepo(baseUser()), fakeStorage());
    const summary = await service.getProfile('u1');
    expect(summary).toEqual({
      id: 'u1',
      email: 'a@b.com',
      firstName: 'A',
      lastName: 'B',
      phone: null,
      occupation: null,
      companyName: null,
      country: null,
      educationLevelId: null,
      pictureKey: null,
    });
    expect(summary).not.toHaveProperty('passwordHash');
  });

  it('updateProfile() only writes the provided fields (omitted fields never cleared)', async () => {
    const repo = fakeProfilesRepo(baseUser());
    const service = new ProfileService({ maxAvatarSizeBytes: 5_242_880 }, repo, fakeStorage());
    await service.updateProfile('u1', { firstName: 'New' });
    expect(repo.updateFields).toHaveBeenCalledWith('u1', { firstName: 'New' });
  });

  it('updateProfile() throws NotFoundDomainError for a vanished user', async () => {
    const service = new ProfileService({ maxAvatarSizeBytes: 5_242_880 }, fakeProfilesRepo(), fakeStorage());
    await expect(service.updateProfile('missing', { firstName: 'X' })).rejects.toThrow(NotFoundDomainError);
  });

  describe('uploadPicture', () => {
    async function withTenantScope<T>(fn: () => Promise<T>): Promise<T> {
      return runWithRequestContext({ requestId: randomUUID(), tenantId: 't1' }, fn);
    }

    it('rejects an oversized file', async () => {
      const service = new ProfileService({ maxAvatarSizeBytes: 10 }, fakeProfilesRepo(baseUser()), fakeStorage());
      await withTenantScope(() =>
        expect(service.uploadPicture('u1', { buffer: Buffer.alloc(20), size: 20 })).rejects.toThrow(FileTooLargeError),
      );
    });

    it('rejects a buffer whose magic bytes are not JPEG/PNG/WebP, regardless of size', async () => {
      const service = new ProfileService({ maxAvatarSizeBytes: 5_242_880 }, fakeProfilesRepo(baseUser()), fakeStorage());
      const buffer = Buffer.from('not an image');
      await withTenantScope(() =>
        expect(service.uploadPicture('u1', { buffer, size: buffer.length })).rejects.toThrow(UnsupportedImageTypeError),
      );
    });

    it('writes a real PNG under a server-generated, tenant-namespaced key and records it on the user row', async () => {
      const repo = fakeProfilesRepo(baseUser());
      const storage = fakeStorage();
      const service = new ProfileService({ maxAvatarSizeBytes: 5_242_880 }, repo, storage);

      const result = await withTenantScope(() => service.uploadPicture('u1', { buffer: PNG_MAGIC, size: PNG_MAGIC.length }));

      expect(storage.put).toHaveBeenCalledWith(expect.stringMatching(/^tenants\/t1\/avatars\/u1\/[\w-]+\.png$/), PNG_MAGIC, 'image/png');
      expect(repo.setPicture).toHaveBeenCalledWith('u1', expect.stringMatching(/^tenants\/t1\//));
      expect(result.pictureKey).toMatch(/^tenants\/t1\/avatars\/u1\//);
    });

    it('throws UserNotFoundError-equivalent (NotFoundDomainError) for a vanished user', async () => {
      const service = new ProfileService({ maxAvatarSizeBytes: 5_242_880 }, fakeProfilesRepo(), fakeStorage());
      await withTenantScope(() =>
        expect(service.uploadPicture('missing', { buffer: PNG_MAGIC, size: PNG_MAGIC.length })).rejects.toThrow(NotFoundDomainError),
      );
    });
  });
});
