import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { runWithRequestContext } from '@/server/context';
import { UnauthenticatedError } from '@/server/common/errors/domain-error';
import { requireTenantUser } from './require-tenant-user';

describe('requireTenantUser — rejection paths not requiring real MySQL', () => {
  it('rejects with no Authorization header at all', async () => {
    const request = new NextRequest('http://localhost/api/auth/me');
    await expect(requireTenantUser(request)).rejects.toThrow(UnauthenticatedError);
  });

  it('rejects a malformed (non-"Bearer ") Authorization header', async () => {
    const request = new NextRequest('http://localhost/api/auth/me', { headers: { authorization: 'Token abc123' } });
    await expect(requireTenantUser(request)).rejects.toThrow(UnauthenticatedError);
  });

  it('rejects a syntactically-Bearer but garbage token', async () => {
    const request = new NextRequest('http://localhost/api/auth/me', { headers: { authorization: 'Bearer garbage' } });
    await expect(requireTenantUser(request)).rejects.toThrow(UnauthenticatedError);
  });

  it('rejects a well-formed, correctly-signed token when called outside any resolved tenant scope', async () => {
    const { JwtTenantTokenAdapter } = await import('@/server/infrastructure/security');
    const { getEnv } = await import('@/server/config');
    const env = getEnv();
    const adapter = new JwtTenantTokenAdapter(env.JWT_TENANT_SECRET, env.JWT_TENANT_TTL);
    const { token } = await adapter.issue({ userId: 'u1', tenantId: 'tenant-1', tenantSlug: 'acme' });

    const request = new NextRequest('http://localhost/api/auth/me', { headers: { authorization: `Bearer ${token}` } });
    // No ALS context bound at all — ctx?.tenantId is undefined, must reject.
    await expect(requireTenantUser(request)).rejects.toThrow(UnauthenticatedError);
  });

  it('rejects when the ALS-bound tenantId differs from the token\'s own tid claim', async () => {
    const { JwtTenantTokenAdapter } = await import('@/server/infrastructure/security');
    const { getEnv } = await import('@/server/config');
    const env = getEnv();
    const adapter = new JwtTenantTokenAdapter(env.JWT_TENANT_SECRET, env.JWT_TENANT_TTL);
    const { token } = await adapter.issue({ userId: 'u1', tenantId: 'tenant-1', tenantSlug: 'acme' });

    const request = new NextRequest('http://localhost/api/auth/me', { headers: { authorization: `Bearer ${token}` } });
    await runWithRequestContext({ requestId: 'r1', tenantId: 'a-different-tenant' }, async () => {
      await expect(requireTenantUser(request)).rejects.toThrow(UnauthenticatedError);
    });
  });
});
