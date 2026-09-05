import { GetTranscriptUseCase } from './get-transcript.use-case';

function actor(overrides: Record<string, unknown> = {}) {
  return { id: 'a1', email: 'a@x.com', roles: ['admin'], tenantIds: ['t1'], ...overrides };
}

function makeDetail(overrides: Record<string, unknown> = {}) {
  return { id: 's1', tenantId: 't1', transcriptPurged: false, ...overrides };
}

describe('GetTranscriptUseCase', () => {
  function make(detail: unknown = makeDetail()) {
    const search = { findDetail: jest.fn().mockResolvedValue(detail) };
    const utterances = {
      listBySession: jest.fn().mockResolvedValue([
        { seq: 0, role: 'user', text: 'hi', startedAt: new Date('2026-01-01T00:00:00.000Z'), endedAt: null },
      ]),
    };
    const useCase = new GetTranscriptUseCase(search as never, utterances as never);
    return { useCase, search, utterances };
  }

  it('404s for an unknown or cross-tenant session', async () => {
    const { useCase } = make(null);
    await expect(useCase.execute(actor(), 'missing')).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('410s TRANSCRIPT_PURGED for a purged session', async () => {
    const { useCase, utterances } = make(makeDetail({ transcriptPurged: true }));
    await expect(useCase.execute(actor(), 's1')).rejects.toMatchObject({ code: 'TRANSCRIPT_PURGED', httpStatus: 410 });
    expect(utterances.listBySession).not.toHaveBeenCalled();
  });

  it('returns the ordered transcript', async () => {
    const { useCase } = make();
    const result = await useCase.execute(actor(), 's1');
    expect(result.items).toEqual([{ seq: 0, role: 'user', text: 'hi', started_at: '2026-01-01T00:00:00.000Z', ended_at: null }]);
  });
});
