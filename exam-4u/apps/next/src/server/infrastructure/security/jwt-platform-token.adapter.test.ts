import { describe, expect, it } from 'vitest';
import { JwtPlatformTokenAdapter } from './jwt-platform-token.adapter';
import { JwtTenantTokenAdapter } from './jwt-tenant-token.adapter';

describe('JwtPlatformTokenAdapter', () => {
  it('issues a token that verifies back to the identical adminId', async () => {
    const adapter = new JwtPlatformTokenAdapter('platform-secret', '60m');
    const { token, expiresInSeconds } = await adapter.issue({ adminId: 'admin-1' });
    expect(expiresInSeconds).toBe(3600);

    const decoded = await adapter.verify(token);
    expect(decoded).toMatchObject({ adminId: 'admin-1' });
  });

  it('rejects a token signed with a different secret', async () => {
    const issuer = new JwtPlatformTokenAdapter('secret-a', '60m');
    const verifier = new JwtPlatformTokenAdapter('secret-b', '60m');
    const { token } = await issuer.issue({ adminId: 'admin-1' });
    expect(await verifier.verify(token)).toBeNull();
  });

  it('rejects a genuine tenant-realm token even when both realms happen to share a secret (aud/typ barrier)', async () => {
    const sharedSecret = 'shared-secret-for-this-test-only';
    const tenantAdapter = new JwtTenantTokenAdapter(sharedSecret, '60m');
    const { token } = await tenantAdapter.issue({ userId: 'user-1', tenantId: 'tenant-1', tenantSlug: 'acme' });

    const platformAdapter = new JwtPlatformTokenAdapter(sharedSecret, '60m');
    expect(await platformAdapter.verify(token)).toBeNull();
  });

  it('never throws to verify() when the secret is unconfigured', async () => {
    const adapter = new JwtPlatformTokenAdapter(undefined, '60m');
    await expect(adapter.verify('anything')).resolves.toBeNull();
  });

  it('throws from issue() when the secret is unconfigured', async () => {
    const adapter = new JwtPlatformTokenAdapter(undefined, '60m');
    await expect(adapter.issue({ adminId: 'admin-1' })).rejects.toThrow(/JWT_PLATFORM_SECRET is not configured/);
  });

  it('rejects a malformed token string without throwing', async () => {
    const adapter = new JwtPlatformTokenAdapter('platform-secret', '60m');
    await expect(adapter.verify('garbage')).resolves.toBeNull();
  });
});
