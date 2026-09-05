import { PurgeExpiredTranscriptsUseCase } from './purge-expired-transcripts.use-case';

describe('PurgeExpiredTranscriptsUseCase', () => {
  it('delegates to the utterance repository and returns the purged count', async () => {
    const utterances = { purgeExpired: jest.fn().mockResolvedValue(3) };
    const useCase = new PurgeExpiredTranscriptsUseCase(utterances as never);
    const result = await useCase.execute();
    expect(result).toBe(3);
    expect(utterances.purgeExpired).toHaveBeenCalledTimes(1);
  });

  it('returns 0 without error when nothing is past retention', async () => {
    const utterances = { purgeExpired: jest.fn().mockResolvedValue(0) };
    const useCase = new PurgeExpiredTranscriptsUseCase(utterances as never);
    expect(await useCase.execute()).toBe(0);
  });
});
