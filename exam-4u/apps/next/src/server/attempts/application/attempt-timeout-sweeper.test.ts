import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { AttemptTimeoutSweeper } from './attempt-timeout-sweeper';

const silentLogger = pino({ level: 'silent' });

function buildRepo(overrides: Record<string, unknown> = {}) {
  return {
    findTimedOutCandidateIds: vi.fn().mockResolvedValue([]),
    closeAndScore: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('AttemptTimeoutSweeper.sweepTenant', () => {
  it('closes every candidate returned and counts only successful closes', async () => {
    const repo = buildRepo({
      findTimedOutCandidateIds: vi.fn().mockResolvedValue(['a-1', 'a-2', 'a-3']),
      closeAndScore: vi
        .fn()
        .mockResolvedValueOnce({ status: 'TimedOut', answeredCount: 1, correctCount: 1, wrongCount: 0, scorePercent: 100 })
        .mockResolvedValueOnce(null) // raced with the lazy path — already closed, not double-counted
        .mockResolvedValueOnce({ status: 'TimedOut', answeredCount: 0, correctCount: 0, wrongCount: 0, scorePercent: 0 }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sweeper = new AttemptTimeoutSweeper(repo as any, silentLogger);
    const closed = await sweeper.sweepTenant();
    expect(closed).toBe(2);
    expect(repo.closeAndScore).toHaveBeenCalledTimes(3);
  });

  it('tolerates one candidate throwing unexpectedly without blocking the rest of the batch', async () => {
    const repo = buildRepo({
      findTimedOutCandidateIds: vi.fn().mockResolvedValue(['a-1', 'a-2']),
      closeAndScore: vi
        .fn()
        .mockRejectedValueOnce(new Error('transient db error'))
        .mockResolvedValueOnce({ status: 'TimedOut', answeredCount: 0, correctCount: 0, wrongCount: 0, scorePercent: 0 }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sweeper = new AttemptTimeoutSweeper(repo as any, silentLogger);
    const closed = await sweeper.sweepTenant();
    expect(closed).toBe(1);
    expect(repo.closeAndScore).toHaveBeenCalledTimes(2);
  });

  it('returns 0 with no candidates and never calls closeAndScore', async () => {
    const repo = buildRepo();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sweeper = new AttemptTimeoutSweeper(repo as any, silentLogger);
    const closed = await sweeper.sweepTenant();
    expect(closed).toBe(0);
    expect(repo.closeAndScore).not.toHaveBeenCalled();
  });
});
