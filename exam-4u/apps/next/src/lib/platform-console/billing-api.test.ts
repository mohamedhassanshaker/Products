import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTenantCheckoutSession, getTenantBilling, reassignTenantSubscription } from './billing-api';

/** Pure request-shape tests for `billing-api.ts` — stubs `fetch` directly, mirroring
 * `features-api.test.ts`/`packages-api.test.ts`'s own established convention. */
describe('billing-api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('getTenantBilling GETs the encoded per-tenant billing route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ subscription: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await getTenantBilling('t 1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/platform/tenants/t%201/billing');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET');
  });

  it('reassignTenantSubscription PUTs the exact packageId body shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ subscription: { packageId: 'p1' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await reassignTenantSubscription('t1', 'p1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/platform/tenants/t1/billing');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ packageId: 'p1' });
  });

  it('createTenantCheckoutSession POSTs to the checkout-session sub-route with the exact packageId body shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: 'https://checkout.stripe.com/cs_1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await createTenantCheckoutSession('t1', 'p1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/platform/tenants/t1/billing/checkout-session');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ packageId: 'p1' });
    expect(result).toEqual({ url: 'https://checkout.stripe.com/cs_1' });
  });
});
