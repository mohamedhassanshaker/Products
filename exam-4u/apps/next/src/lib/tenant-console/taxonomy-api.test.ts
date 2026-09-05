import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEducationLevel,
  createStage,
  createSubject,
  deleteEducationLevel,
  deleteStage,
  deleteSubject,
  listEducationLevels,
  listStages,
  listSubjects,
} from './taxonomy-api';

describe('taxonomy-api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('listEducationLevels GETs the plain, unparameterized route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await listEducationLevels();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/taxonomy/education-levels');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET');
  });

  it('createEducationLevel POSTs {name}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1, name: 'Secondary' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await createEducationLevel('Secondary');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/taxonomy/education-levels');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ name: 'Secondary' });
  });

  it('deleteEducationLevel DELETEs /api/taxonomy/education-levels/:id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await deleteEducationLevel(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/taxonomy/education-levels/1');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
  });

  it('listStages GETs with the educationLevelId query param', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await listStages(5);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/taxonomy/stages?educationLevelId=5');
  });

  it('createStage POSTs {educationLevelId, name}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await createStage(5, 'Grade 10');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ educationLevelId: 5, name: 'Grade 10' });
  });

  it('deleteStage DELETEs /api/taxonomy/stages/:id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await deleteStage(10);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/taxonomy/stages/10');
  });

  it('listSubjects GETs with the stageId query param', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await listSubjects(10);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/taxonomy/subjects?stageId=10');
  });

  it('createSubject POSTs {stageId, name}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await createSubject(10, 'Biology');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ stageId: 10, name: 'Biology' });
  });

  it('deleteSubject DELETEs /api/taxonomy/subjects/:id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await deleteSubject(100);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/taxonomy/subjects/100');
  });
});
