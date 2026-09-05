import { ListSessionsUseCase } from './list-sessions.use-case';

function actor(overrides: Record<string, unknown> = {}) {
  return { id: 'a1', email: 'a@x.com', roles: ['admin'], tenantIds: ['t1'], ...overrides };
}

describe('ListSessionsUseCase', () => {
  function make() {
    const search = { search: jest.fn().mockResolvedValue({ items: [], total: 0 }), findDetail: jest.fn() };
    const utterances = { searchSessionIds: jest.fn().mockResolvedValue(['s1']) };
    const useCase = new ListSessionsUseCase(search as never, utterances as never);
    return { useCase, search, utterances };
  }

  it('rejects q longer than 200 chars', async () => {
    const { useCase } = make();
    await expect(useCase.execute(actor(), { q: 'x'.repeat(201) })).rejects.toMatchObject({ code: 'SESS_QUERY_TOO_LONG' });
  });

  it('rejects from > to', async () => {
    const { useCase } = make();
    await expect(
      useCase.execute(actor(), { from: '2026-01-10T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' }),
    ).rejects.toMatchObject({ code: 'SESS_RANGE_INVALID' });
  });

  it('rejects an out-of-range page_size', async () => {
    const { useCase } = make();
    await expect(useCase.execute(actor(), { page_size: 101 })).rejects.toMatchObject({ code: 'PAGE_SIZE_INVALID' });
  });

  it('operator with no tenant_id searches with no tenant filter (null)', async () => {
    const { useCase, search } = make();
    await useCase.execute(actor({ roles: ['operator'], tenantIds: [] }), {});
    expect(search.search).toHaveBeenCalledWith(expect.objectContaining({ tenantIds: null }));
  });

  it('admin with no tenant_id is scoped to their own assigned tenants', async () => {
    const { useCase, search } = make();
    await useCase.execute(actor({ tenantIds: ['t1', 't2'] }), {});
    expect(search.search).toHaveBeenCalledWith(expect.objectContaining({ tenantIds: ['t1', 't2'] }));
  });

  it('admin naming a tenant_id they are not assigned to gets an empty scope, not an error', async () => {
    const { useCase, search } = make();
    await useCase.execute(actor({ tenantIds: ['t1'] }), { tenant_id: 't2' });
    expect(search.search).toHaveBeenCalledWith(expect.objectContaining({ tenantIds: [] }));
  });

  it('admin naming their own assigned tenant_id scopes to just that tenant', async () => {
    const { useCase, search } = make();
    await useCase.execute(actor({ tenantIds: ['t1'] }), { tenant_id: 't1' });
    expect(search.search).toHaveBeenCalledWith(expect.objectContaining({ tenantIds: ['t1'] }));
  });

  it('a full-text q resolves to session ids via the utterance search first', async () => {
    const { useCase, search, utterances } = make();
    await useCase.execute(actor({ roles: ['operator'], tenantIds: [] }), { q: 'hello' });
    expect(utterances.searchSessionIds).toHaveBeenCalledWith('hello', undefined);
    expect(search.search).toHaveBeenCalledWith(expect.objectContaining({ sessionIds: ['s1'] }));
  });

  it('passes the single scoped tenant id into the full-text search itself', async () => {
    const { useCase, utterances } = make();
    await useCase.execute(actor({ tenantIds: ['t1'] }), { q: 'hello' });
    expect(utterances.searchSessionIds).toHaveBeenCalledWith('hello', 't1');
  });

  it('returns items/total/page/page_size', async () => {
    const { useCase, search } = make();
    search.search.mockResolvedValue({
      items: [
        {
          id: 's1',
          tenantId: 't1',
          tenantSlug: 'acme',
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          endedAt: null,
          status: 'active',
          providerStack: { transport: 'livekit', stt: null, llm: null, llmFallback: null, tts: null, avatar: null },
          errorCode: null,
          transcriptPurged: false,
        },
      ],
      total: 1,
    });
    const result = await useCase.execute(actor({ roles: ['operator'], tenantIds: [] }), { page: 2, page_size: 10 });
    expect(result.total).toBe(1);
    expect(result.page).toBe(2);
    expect(result.page_size).toBe(10);
    expect(result.items[0].id).toBe('s1');
  });
});
