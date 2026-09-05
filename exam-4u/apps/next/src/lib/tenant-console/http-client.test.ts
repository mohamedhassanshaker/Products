import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tenantFetch } from './http-client';
import { TenantApiError } from './api-error';
import { clearStoredTenantToken, setStoredTenantToken } from './token-storage';

/** Pure-logic tests for `tenantFetch` — mirrors `lib/platform-console/http-client.test.ts`'s identical
 * structure/coverage for the tenant realm's own fetch chokepoint. */
describe('tenantFetch', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    };
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
    vi.unstubAllGlobals();
  });

  it('attaches the stored bearer token as an Authorization header when one is present', async () => {
    setStoredTenantToken('a-real-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await tenantFetch('/api/curricula');

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('authorization')).toBe('Bearer a-real-token');
  });

  it('sends no Authorization header at all when no token is stored (e.g. the login call itself)', async () => {
    clearStoredTenantToken();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await tenantFetch('/api/auth/login');

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.has('authorization')).toBe(false);
  });

  it('throws a TenantApiError carrying the parsed ErrorEnvelope code/message/details on a non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_CURRICULUM_OWNER', message: 'nope', requestId: 'r1', timestamp: 't1' } }), {
        status: 403,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(tenantFetch('/api/curricula/x')).rejects.toMatchObject({ status: 403, code: 'NOT_CURRICULUM_OWNER', message: 'nope' });
  });

  it('falls back to a generic UNKNOWN_ERROR on a non-2xx response with a malformed/non-JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await tenantFetch('/api/curricula').catch((e) => e);
    expect(error).toBeInstanceOf(TenantApiError);
    expect((error as TenantApiError).code).toBe('UNKNOWN_ERROR');
    expect((error as TenantApiError).status).toBe(502);
  });

  it('throws a NETWORK_ERROR TenantApiError when fetch itself rejects (offline/DNS/CORS)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(tenantFetch('/api/curricula')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('returns undefined for a 204 No Content response without attempting to parse a body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(tenantFetch('/api/curricula/x')).resolves.toBeUndefined();
  });
});
