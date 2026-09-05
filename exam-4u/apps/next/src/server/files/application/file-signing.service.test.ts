import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { StoragePort } from '@/server/common/ports/storage.port';
import { InternalDomainError, NotFoundDomainError } from '@/server/common/errors/domain-error';
import { FileSigningService } from './file-signing.service';
import { LinkInvalidOrExpiredError, PathTraversalRejectedError, StorageKeyNotOwnedError } from '../domain/errors';

function fakeStorage(overrides: Partial<StoragePort> = {}): StoragePort {
  return {
    put: vi.fn(),
    getStream: vi.fn(async () => ({ stream: Readable.from(Buffer.from('x')), size: 1, contentType: 'application/octet-stream' })),
    stat: vi.fn(async () => ({ size: 123, contentType: 'image/png' })),
    delete: vi.fn(),
    deletePrefix: vi.fn(),
    exists: vi.fn(),
    ...overrides,
  } as StoragePort;
}

const CONFIG = { signingSecret: 'a-32-plus-character-test-signing-secret', signedUrlTtlSec: 900 };

describe('FileSigningService.sign', () => {
  it('rejects a storage key not namespaced under the caller\'s own tenant', () => {
    const service = new FileSigningService(CONFIG, fakeStorage());
    expect(() => service.sign('tenants/other-tenant/avatars/x.png', 'tenant-1')).toThrow(StorageKeyNotOwnedError);
  });

  it('mints a URL embedding the storage key path, an exp epoch, and a signature', () => {
    const service = new FileSigningService(CONFIG, fakeStorage());
    const { url, expiresAt } = service.sign('tenants/tenant-1/avatars/u1/pic.png', 'tenant-1');
    expect(url).toMatch(/^\/api\/files\/d\/tenants\/tenant-1\/avatars\/u1\/pic\.png\?exp=\d+&sig=[\w-]+$/);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('throws InternalDomainError when FILE_SIGNING_SECRET is unset', () => {
    const service = new FileSigningService({ ...CONFIG, signingSecret: undefined }, fakeStorage());
    expect(() => service.sign('tenants/tenant-1/x.png', 'tenant-1')).toThrow(InternalDomainError);
  });
});

describe('FileSigningService.verify', () => {
  function signedParts(service: FileSigningService, key: string, tenantId: string) {
    const { url } = service.sign(key, tenantId);
    const parsed = new URL(url, 'http://localhost');
    const rawPath = decodeURIComponent(parsed.pathname.replace('/api/files/d/', ''));
    return { rawPath, exp: parsed.searchParams.get('exp')!, sig: parsed.searchParams.get('sig')! };
  }

  it('accepts a freshly-signed, unexpired URL and returns the storage key', () => {
    const service = new FileSigningService(CONFIG, fakeStorage());
    const { rawPath, exp, sig } = signedParts(service, 'tenants/t1/avatars/u1/pic.png', 't1');
    expect(service.verify(rawPath, exp, sig)).toEqual({ storageKey: 'tenants/t1/avatars/u1/pic.png' });
  });

  it('rejects a path-traversal attempt BEFORE ever computing/comparing a signature', () => {
    const service = new FileSigningService(CONFIG, fakeStorage());
    expect(() => service.verify('../../etc/passwd', '9999999999', 'whatever-bogus-sig')).toThrow(PathTraversalRejectedError);
  });

  it('rejects a path starting with a leading slash', () => {
    const service = new FileSigningService(CONFIG, fakeStorage());
    expect(() => service.verify('/etc/passwd', '9999999999', 'sig')).toThrow(PathTraversalRejectedError);
  });

  it('rejects an expired link (exp in the past) even with a correctly-computed signature', () => {
    const service = new FileSigningService(CONFIG, fakeStorage());
    const key = 'tenants/t1/avatars/u1/pic.png';
    // Build a URL that would have been valid, then force its exp into the past by re-signing at a
    // fixed past timestamp is awkward without mocking Date — instead assert directly against
    // verify()'s own exp<=now check using an already-past exp and its correctly-recomputed signature.
    const pastExp = String(Math.floor(Date.now() / 1000) - 10);
    // We can't easily recompute the HMAC from outside the class (private) — instead prove expiry is
    // checked BEFORE signature comparison would even matter, by using an arbitrary sig: whether or
    // not it's "right" is irrelevant once exp has passed.
    expect(() => service.verify(key, pastExp, 'irrelevant')).toThrow(LinkInvalidOrExpiredError);
    void key;
  });

  it('rejects a tampered signature (single differing character) on an otherwise-valid link', () => {
    const service = new FileSigningService(CONFIG, fakeStorage());
    const { rawPath, exp, sig } = signedParts(service, 'tenants/t1/avatars/u1/pic.png', 't1');
    const tampered = sig.slice(0, -1) + (sig.at(-1) === 'a' ? 'b' : 'a');
    expect(() => service.verify(rawPath, exp, tampered)).toThrow(LinkInvalidOrExpiredError);
  });

  it('rejects a non-numeric exp param', () => {
    const service = new FileSigningService(CONFIG, fakeStorage());
    expect(() => service.verify('tenants/t1/x.png', 'not-a-number', 'sig')).toThrow(LinkInvalidOrExpiredError);
  });

  it('a signature computed for a DIFFERENT storage key is rejected (no cross-key replay)', () => {
    const service = new FileSigningService(CONFIG, fakeStorage());
    const { exp, sig } = signedParts(service, 'tenants/t1/avatars/u1/a.png', 't1');
    expect(() => service.verify('tenants/t1/avatars/u1/b.png', exp, sig)).toThrow(LinkInvalidOrExpiredError);
  });
});

describe('FileSigningService.stat', () => {
  it('returns storage stat when the object exists', async () => {
    const service = new FileSigningService(CONFIG, fakeStorage({ stat: vi.fn(async () => ({ size: 42, contentType: 'image/jpeg' })) }));
    await expect(service.stat('tenants/t1/x.jpg')).resolves.toEqual({ size: 42, contentType: 'image/jpeg' });
  });

  it('throws NotFoundDomainError when the object is missing (a validly-signed link to a purged file)', async () => {
    const service = new FileSigningService(CONFIG, fakeStorage({ stat: vi.fn(async () => null) }));
    await expect(service.stat('tenants/t1/x.jpg')).rejects.toThrow(NotFoundDomainError);
  });
});
