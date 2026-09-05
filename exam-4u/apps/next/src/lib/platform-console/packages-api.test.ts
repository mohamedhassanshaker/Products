import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPackage, getPackage, listPackages, replacePackageFeatures, updatePackage } from './packages-api';

/** Pure request-shape tests for `packages-api.ts` — stubs `fetch` directly, mirroring
 * `tenants-api.test.ts`'s own established convention. */
describe('packages-api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('listPackages GETs the collection route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await listPackages();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/platform/packages');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET');
  });

  it('getPackage GETs the encoded per-id route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await getPackage('p 1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/platform/packages/p%201');
  });

  it('createPackage POSTs the exact body shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'p1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await createPackage({ key: 'pro', name: 'Pro', priceCents: 2900 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/platform/packages');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ key: 'pro', name: 'Pro', priceCents: 2900 });
  });

  it('updatePackage PATCHes the per-id route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await updatePackage('p1', { isActive: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/platform/packages/p1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ isActive: false });
  });

  it('replacePackageFeatures PUTs the {features} body shape to the /features sub-route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'p1', features: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await replacePackageFeatures('p1', [{ featureId: 'f1', limit: 5 }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/platform/packages/p1/features');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ features: [{ featureId: 'f1', limit: 5 }] });
  });
});
