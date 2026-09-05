import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { withTenantContext } from './with-tenant-context';

describe('withTenantContext — defensive missing-header path', () => {
  it('returns a 500 INTERNAL_ERROR envelope when the trusted tenant headers are absent (should be unreachable in production)', async () => {
    const request = new NextRequest('http://localhost/api/auth/me');
    const response = await withTenantContext(request, async () => new Response('should not run'));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('echoes a caller-supplied X-Request-Id into the error envelope', async () => {
    const request = new NextRequest('http://localhost/api/auth/me', { headers: { 'x-request-id': 'my-request-id' } });
    const response = await withTenantContext(request, async () => new Response('should not run'));
    const body = await response.json();
    expect(body.error.requestId).toBe('my-request-id');
  });
});
