import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  approveAiModel,
  assignTenantAiModel,
  deleteAiModel,
  getAiModel,
  listAiModels,
  setDefaultAiModel,
  unassignTenantAiModel,
  updateAiModel,
} from './ai-models-api';

/** Pure request-shape tests for `ai-models-api.ts` — stubs `fetch` directly, mirroring
 * `tenants-api.test.ts`'s own established convention. */
describe('ai-models-api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('listAiModels defaults to omitting includeDisabled entirely', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await listAiModels();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/platform/ai-models');
  });

  it('listAiModels(true) appends ?includeDisabled=true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await listAiModels(true);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/platform/ai-models?includeDisabled=true');
  });

  it('getAiModel GETs the encoded per-id route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'm1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await getAiModel('m 1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/platform/ai-models/m%201');
  });

  it('approveAiModel POSTs the exact body shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'm1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await approveAiModel({ openRouterModelId: 'anthropic/claude-3.5-haiku', displayName: 'Claude' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/platform/ai-models');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ openRouterModelId: 'anthropic/claude-3.5-haiku', displayName: 'Claude' });
  });

  it('updateAiModel PATCHes the per-id route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'm1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await updateAiModel('m1', { isEnabled: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/platform/ai-models/m1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ isEnabled: false });
  });

  it('setDefaultAiModel PUTs the /default sub-route with no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'm1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await setDefaultAiModel('m1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/platform/ai-models/m1/default');
    expect(init.method).toBe('PUT');
  });

  it('deleteAiModel DELETEs the per-id route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await deleteAiModel('m1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/platform/ai-models/m1');
    expect(init.method).toBe('DELETE');
  });

  it('assignTenantAiModel PUTs {approvedAiModelId} to the tenant ai-model route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ source: 'assigned', openRouterModelId: 'x', displayName: 'y' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await assignTenantAiModel('t1', 'm1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/platform/tenants/t1/ai-model');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ approvedAiModelId: 'm1' });
  });

  it('unassignTenantAiModel DELETEs the tenant ai-model route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ source: 'platform_default', openRouterModelId: 'x', displayName: 'y' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await unassignTenantAiModel('t1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/platform/tenants/t1/ai-model');
    expect(init.method).toBe('DELETE');
  });
});
