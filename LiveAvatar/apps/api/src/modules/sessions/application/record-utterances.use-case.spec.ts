import { RecordUtterancesUseCase } from './record-utterances.use-case';

describe('RecordUtterancesUseCase', () => {
  function make(session: unknown) {
    const sessions = { findById: jest.fn().mockResolvedValue(session) };
    const utterances = { upsertMany: jest.fn().mockResolvedValue(undefined) };
    const useCase = new RecordUtterancesUseCase(sessions as never, utterances as never);
    return { useCase, sessions, utterances };
  }

  it('throws SESSION_NOT_FOUND for an unknown session id', async () => {
    const { useCase } = make(null);
    await expect(useCase.execute('s1', { items: [] })).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('maps wire items to UtteranceInput and upserts them with the session tenantId', async () => {
    const { useCase, utterances } = make({ id: 's1', tenantId: 't1' });
    await useCase.execute('s1', {
      items: [
        { seq: 1, role: 'user', text: 'hello', started_at: '2026-01-01T00:00:00.000Z' },
        { seq: 2, role: 'assistant', started_at: '2026-01-01T00:00:01.000Z', ended_at: '2026-01-01T00:00:02.000Z' },
      ],
    });
    expect(utterances.upsertMany).toHaveBeenCalledWith('s1', 't1', [
      { seq: 1, role: 'user', text: 'hello', startedAt: new Date('2026-01-01T00:00:00.000Z'), endedAt: null },
      {
        seq: 2,
        role: 'assistant',
        text: null,
        startedAt: new Date('2026-01-01T00:00:01.000Z'),
        endedAt: new Date('2026-01-01T00:00:02.000Z'),
      },
    ]);
  });
});
