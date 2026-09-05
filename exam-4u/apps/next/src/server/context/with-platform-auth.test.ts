import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { withPlatformAuth } from './with-platform-auth';

describe('withPlatformAuth — rejection paths not requiring real MySQL', () => {
  it('rejects with no Authorization header at all', async () => {
    const request = new NextRequest('http://localhost/api/platform/auth/me');
    const response = await withPlatformAuth(request, async () => new Response('should not run'));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.message).toMatch(/bearer token is required/i);
  });

  it('rejects a malformed (non-"Bearer ") Authorization header', async () => {
    const request = new NextRequest('http://localhost/api/platform/auth/me', { headers: { authorization: 'Basic abc123' } });
    const response = await withPlatformAuth(request, async () => new Response('should not run'));
    expect(response.status).toBe(401);
  });

  it('rejects a syntactically-Bearer but garbage token', async () => {
    const request = new NextRequest('http://localhost/api/platform/auth/me', { headers: { authorization: 'Bearer not-a-real-jwt' } });
    const response = await withPlatformAuth(request, async () => new Response('should not run'));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.message).toMatch(/invalid or has expired/i);
  });
});
