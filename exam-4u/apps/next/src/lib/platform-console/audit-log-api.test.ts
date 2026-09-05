import { afterEach, describe, expect, it, vi } from 'vitest';
import { listAuditLog } from './audit-log-api';

/** Pure request-shape tests for `audit-log-api.ts` — stubs `fetch` directly, mirroring
 * `features-api.test.ts`'s own established convention. */
describe('audit-log-api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('listAuditLog GETs the collection route with no query string when no filters are supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await listAuditLog();

    expect(fetchMock.mock.calls[0][0]).toBe('/api/platform/audit-log');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET');
  });

  it('listAuditLog builds a query string from only the supplied filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await listAuditLog({ actorId: 'admin-1', action: 'tenant.suspend', page: 2, pageSize: 10 });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/platform/audit-log?');
    expect(url).toContain('actorId=admin-1');
    expect(url).toContain('action=tenant.suspend');
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=10');
  });

  it('returns the parsed AuditLogListResult', async () => {
    const body = {
      items: [
        {
          id: 'row-1',
          actorType: 'PlatformAdmin',
          actorId: 'admin-1',
          tenantId: null,
          action: 'feature.create',
          targetType: 'Feature',
          targetId: 'feat-1',
          summary: { key: 'exams.create' },
          ip: null,
          createdAt: '2026-08-15T00:00:00.000Z',
        },
      ],
      total: 1,
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await listAuditLog();

    expect(result).toEqual(body);
  });
});
