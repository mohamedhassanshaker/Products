import { describe, expect, it } from 'vitest';
import { JwtTenantTokenAdapter } from './jwt-tenant-token.adapter';

const CLAIMS = { userId: 'user-1', tenantId: 'tenant-1', tenantSlug: 'acme' };

describe('JwtTenantTokenAdapter', () => {
  it('issues a token that verifies back to the identical claims', async () => {
    const adapter = new JwtTenantTokenAdapter('tenant-secret', '60m');
    const { token, expiresInSeconds } = await adapter.issue(CLAIMS);
    expect(expiresInSeconds).toBe(3600);

    const decoded = await adapter.verify(token);
    expect(decoded).not.toBeNull();
    expect(decoded).toMatchObject({ userId: 'user-1', tenantId: 'tenant-1', tenantSlug: 'acme' });
    expect(decoded!.jti).toEqual(expect.any(String));
    expect(decoded!.jti.length).toBeGreaterThan(0);
  });

  it('rejects a token signed with a different secret (realm/tenant-forgery barrier #1)', async () => {
    const issuer = new JwtTenantTokenAdapter('secret-a', '60m');
    const verifier = new JwtTenantTokenAdapter('secret-b', '60m');
    const { token } = await issuer.issue(CLAIMS);
    expect(await verifier.verify(token)).toBeNull();
  });

  it('rejects a platform-realm token presented to the tenant verifier (aud/typ mismatch)', async () => {
    // A platform token shares nothing with a tenant token except (deliberately, in this test) the
    // secret — proving the `aud`/`typ` claims, not just the secret, gate cross-realm replay.
    const { SignJWT } = await import('jose');
    const key = new TextEncoder().encode('shared-secret');
    const platformShapedToken = await new SignJWT({ typ: 'platform-admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('admin-1')
      .setAudience('platform')
      .setIssuer('examland')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);

    const verifier = new JwtTenantTokenAdapter('shared-secret', '60m');
    expect(await verifier.verify(platformShapedToken)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const { SignJWT } = await import('jose');
    const key = new TextEncoder().encode('tenant-secret');
    const expired = await new SignJWT({ typ: 'tenant-user', tid: 'tenant-1', tsl: 'acme' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setAudience('tenant')
      .setIssuer('examland')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(key);

    const adapter = new JwtTenantTokenAdapter('tenant-secret', '60m');
    expect(await adapter.verify(expired)).toBeNull();
  });

  it('rejects a malformed token string without throwing', async () => {
    const adapter = new JwtTenantTokenAdapter('tenant-secret', '60m');
    await expect(adapter.verify('not-a-real-jwt')).resolves.toBeNull();
  });

  it('never throws to verify() when the secret is unconfigured (fails closed)', async () => {
    const adapter = new JwtTenantTokenAdapter(undefined, '60m');
    await expect(adapter.verify('anything')).resolves.toBeNull();
  });

  it('throws (a plain Error, not swallowed) from issue() when the secret is unconfigured', async () => {
    const adapter = new JwtTenantTokenAdapter(undefined, '60m');
    await expect(adapter.issue(CLAIMS)).rejects.toThrow(/JWT_TENANT_SECRET is not configured/);
  });

  it('parses a TTL with a unit suffix (e.g. "1h")', async () => {
    const adapter = new JwtTenantTokenAdapter('tenant-secret', '1h');
    const { expiresInSeconds } = await adapter.issue(CLAIMS);
    expect(expiresInSeconds).toBe(3600);
  });
});
