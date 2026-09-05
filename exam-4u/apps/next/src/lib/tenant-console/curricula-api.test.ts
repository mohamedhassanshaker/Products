import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCurriculum, deleteCurriculum, getCurriculum, listCurricula, updateCurriculum } from './curricula-api';

describe('curricula-api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('listCurricula GETs /api/curricula', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await listCurricula();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/curricula');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET');
  });

  it('getCurriculum GETs /api/curricula/:id with the id URL-encoded', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'c/1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await getCurriculum('c/1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/curricula/c%2F1');
  });

  it('createCurriculum POSTs the exact input body shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'c1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await createCurriculum({ name: 'Biology 101', description: 'intro', subjectId: 5 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/curricula');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ name: 'Biology 101', description: 'intro', subjectId: 5 });
  });

  it('updateCurriculum PATCHes /api/curricula/:id with the partial input', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'c1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await updateCurriculum('c1', { name: 'New name' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/curricula/c1');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ name: 'New name' });
  });

  it('deleteCurriculum DELETEs /api/curricula/:id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await deleteCurriculum('c1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/curricula/c1');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
  });
});
