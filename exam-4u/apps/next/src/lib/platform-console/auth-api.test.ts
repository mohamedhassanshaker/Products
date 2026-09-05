import { afterEach, describe, expect, it, vi } from 'vitest';
import { login, me } from './auth-api';

describe('auth-api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('login POSTs {email, password} to /api/platform/auth/login and returns the parsed result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ accessToken: 'tok', expiresInSeconds: 3600, admin: { id: 'a1', email: 'a@b.com', name: 'A', isActive: true, lastLoginAt: null, createdAt: 't' } }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await login('a@b.com', 'pw');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/platform/auth/login');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.com', password: 'pw' });
    expect(result.accessToken).toBe('tok');
    expect(result.admin.email).toBe('a@b.com');
  });

  it('login rejects with the parsed ErrorEnvelope on a 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'bad creds', requestId: 'r', timestamp: 't' } }), { status: 401 }),
      ),
    );
    await expect(login('a@b.com', 'wrong')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });

  it('me GETs /api/platform/auth/me and returns the parsed admin summary', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'a1', email: 'a@b.com', name: 'A', isActive: true, lastLoginAt: null, createdAt: 't' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const admin = await me();

    expect(fetchMock.mock.calls[0][0]).toBe('/api/platform/auth/me');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET');
    expect(admin.id).toBe('a1');
  });
});
