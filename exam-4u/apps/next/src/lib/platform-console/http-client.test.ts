import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { platformFetch } from './http-client';
import { PlatformApiError } from './api-error';
import { clearStoredPlatformToken, setStoredPlatformToken } from './token-storage';

/**
 * Pure-logic tests for `platformFetch` — this module's fetch chokepoint (attaches the stored bearer
 * token, parses `ErrorEnvelope` on a non-2xx response, falls back gracefully on a malformed error body
 * or a network-level failure). Runs under the `node` environment (default for `.test.ts` files, see
 * `vitest.config.ts`) with `localStorage` provided by `happy-dom`/`jsdom`'s absence handled by
 * `token-storage.ts`'s own `typeof window === 'undefined'` guard — so a real browser `window` is
 * stubbed here rather than switching this file to the `jsdom` environment, keeping it a fast, pure
 * unit test.
 */
describe('platformFetch', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    // A minimal `window.localStorage` stand-in — this file intentionally avoids the `jsdom` environment
    // (reserved for `.test.tsx` component tests per `vitest.config.ts`'s `environmentMatchGlobs`), so a
    // tiny in-memory Map-backed stub is enough to exercise `token-storage.ts`'s real code path.
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
    setStoredPlatformToken('a-real-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await platformFetch('/api/platform/tenants');

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('authorization')).toBe('Bearer a-real-token');
  });

  it('sends no Authorization header at all when no token is stored (e.g. the login call itself)', async () => {
    clearStoredPlatformToken();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await platformFetch('/api/platform/auth/login');

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.has('authorization')).toBe(false);
  });

  it('throws a PlatformApiError carrying the parsed ErrorEnvelope code/message/details on a non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'INVALID_TENANT_STATE', message: 'Cannot suspend.', requestId: 'r1', timestamp: 't1' } }),
        { status: 409 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(platformFetch('/api/platform/tenants/x/suspend', { method: 'POST' })).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TENANT_STATE',
      message: 'Cannot suspend.',
    });
  });

  it('falls back to a generic UNKNOWN_ERROR on a non-2xx response with a malformed/non-JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await platformFetch('/api/platform/tenants').catch((e) => e);
    expect(error).toBeInstanceOf(PlatformApiError);
    expect((error as PlatformApiError).code).toBe('UNKNOWN_ERROR');
    expect((error as PlatformApiError).status).toBe(502);
  });

  it('throws a NETWORK_ERROR PlatformApiError when fetch itself rejects (offline/DNS/CORS)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    await expect(platformFetch('/api/platform/tenants')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('returns undefined for a 204 No Content response without attempting to parse a body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(platformFetch('/api/platform/tenants/x')).resolves.toBeUndefined();
  });
});
