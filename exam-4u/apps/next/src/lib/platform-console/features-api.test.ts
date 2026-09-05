import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFeature, deleteFeature, getFeature, listFeatures, updateFeature } from './features-api';

/** Pure request-shape tests for `features-api.ts` — stubs `fetch` directly, mirroring
 * `tenants-api.test.ts`'s own established convention. */
describe('features-api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('listFeatures GETs the collection route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await listFeatures();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/platform/features');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET');
  });

  it('getFeature GETs the encoded per-id route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'f 1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await getFeature('f 1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/platform/features/f%201');
  });

  it('createFeature POSTs the exact body shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'f1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await createFeature({ key: 'exams.create', name: 'Create exams', unit: 'exams', resetPeriod: 'MONTHLY' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/platform/features');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ key: 'exams.create', name: 'Create exams', unit: 'exams', resetPeriod: 'MONTHLY' });
  });

  it('updateFeature PATCHes the per-id route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'f1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await updateFeature('f1', { name: 'Renamed' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/platform/features/f1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ name: 'Renamed' });
  });

  it('deleteFeature DELETEs the per-id route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await deleteFeature('f1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/platform/features/f1');
    expect(init.method).toBe('DELETE');
  });
});
