import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateTenant,
  createTenant,
  getTenant,
  listTenants,
  retryTenantProvisioning,
  softDeleteTenant,
  suspendTenant,
  updateRegistrationSettings,
} from './tenants-api';

/** Pure query-string-building/request-shape tests for `tenants-api.ts` — stubs `fetch` directly and
 * asserts the exact URL/body constructed, rather than re-testing `platformFetch` itself (already
 * covered by `http-client.test.ts`). */
describe('tenants-api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('listTenants builds an empty query string when no params are supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await listTenants();

    expect(fetchMock.mock.calls[0][0]).toBe('/api/platform/tenants');
  });

  it('listTenants serializes status/includeDeleted/page/pageSize into the query string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await listTenants({ status: 'Suspended', includeDeleted: true, page: 2, pageSize: 50 });

    const url = new URL(fetchMock.mock.calls[0][0] as string, 'http://localhost');
    expect(url.pathname).toBe('/api/platform/tenants');
    expect(url.searchParams.get('status')).toBe('Suspended');
    expect(url.searchParams.get('includeDeleted')).toBe('true');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('pageSize')).toBe('50');
  });

  it('listTenants omits includeDeleted from the query string entirely when false (default view)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await listTenants({ includeDeleted: false });

    const url = new URL(fetchMock.mock.calls[0][0] as string, 'http://localhost');
    expect(url.searchParams.has('includeDeleted')).toBe(false);
  });

  it('createTenant POSTs the exact {name, subdomainSlug, adminEmail} body shape the real route expects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 't1', name: 'Acme', status: 'Active' }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createTenant({ name: 'Acme', subdomainSlug: 'acme', adminEmail: 'admin@acme.local' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/platform/tenants');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: 'Acme',
      subdomainSlug: 'acme',
      adminEmail: 'admin@acme.local',
    });
  });

  it('getTenant GETs /api/platform/tenants/:id with the id URL-encoded', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 't/1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await getTenant('t/1');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/platform/tenants/t%2F1');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET');
  });

  it.each([
    ['suspendTenant', suspendTenant, 'suspend'],
    ['activateTenant', activateTenant, 'activate'],
    ['softDeleteTenant', softDeleteTenant, 'soft-delete'],
    ['retryTenantProvisioning', retryTenantProvisioning, 'provisioning/retry'],
  ] as const)('%s POSTs to the correct .../%s action route', async (_name, fn, segment) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 't1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await fn('t1');

    expect(fetchMock.mock.calls[0][0]).toBe(`/api/platform/tenants/t1/${segment}`);
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
  });

  it('updateRegistrationSettings PATCHes the exact input body to the registration-settings route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 't1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await updateRegistrationSettings('t1', { allowGoogleSignIn: true });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/platform/tenants/t1/registration-settings');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ allowGoogleSignIn: true });
  });
});
