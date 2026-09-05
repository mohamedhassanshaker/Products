import { afterEach, describe, expect, it, vi } from 'vitest';
import { getReliabilityDashboard } from './reliability-api';

/** Pure request-shape tests for `reliability-api.ts` — stubs `fetch` directly, mirroring
 * `features-api.test.ts`'s own established convention. */
describe('reliability-api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('getReliabilityDashboard GETs the dashboard route', async () => {
    const body = { outbox: { pending: 0, delivered: 0, deadLetter: 0 }, fileCleanup: { due: 0 }, workHints: [], tenantsScanned: 1 };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getReliabilityDashboard();

    expect(fetchMock.mock.calls[0][0]).toBe('/api/platform/reliability');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET');
    expect(result).toEqual(body);
  });
});
