import { TranscriptPurgeProcessor } from './transcript-purge.processor';

describe('TranscriptPurgeProcessor', () => {
  it('delegates to PurgeExpiredTranscriptsUseCase and returns the purged count', async () => {
    const purge = { execute: jest.fn().mockResolvedValue(4) };
    const processor = new TranscriptPurgeProcessor(purge as never);
    const result = await processor.process({ id: 'job1' } as never);
    expect(purge.execute).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ purged: 4 });
  });
});
