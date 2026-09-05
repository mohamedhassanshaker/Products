import { MemoryLoginRateLimiter } from './memory-login-rate-limiter';

describe('MemoryLoginRateLimiter', () => {
  it('is not rate limited before any failures', async () => {
    const limiter = new MemoryLoginRateLimiter();
    expect(await limiter.tooManyFailures('1.2.3.4', 'a@b.com')).toBe(false);
  });

  it('rate limits after 10 failures within the window', async () => {
    const limiter = new MemoryLoginRateLimiter();
    for (let i = 0; i < 10; i += 1) {
      await limiter.recordFailure('1.2.3.4', 'a@b.com');
    }
    expect(await limiter.tooManyFailures('1.2.3.4', 'a@b.com')).toBe(true);
  });

  it('clear resets the bucket', async () => {
    const limiter = new MemoryLoginRateLimiter();
    for (let i = 0; i < 10; i += 1) {
      await limiter.recordFailure('1.2.3.4', 'a@b.com');
    }
    await limiter.clear('1.2.3.4', 'a@b.com');
    expect(await limiter.tooManyFailures('1.2.3.4', 'a@b.com')).toBe(false);
  });

  it('expires the bucket after the window elapses', async () => {
    jest.useFakeTimers();
    const limiter = new MemoryLoginRateLimiter();
    for (let i = 0; i < 10; i += 1) {
      await limiter.recordFailure('1.2.3.4', 'a@b.com');
    }
    jest.advanceTimersByTime(11 * 60 * 1000);
    expect(await limiter.tooManyFailures('1.2.3.4', 'a@b.com')).toBe(false);
    jest.useRealTimers();
  });

  it('scopes buckets independently per ip+email key', async () => {
    const limiter = new MemoryLoginRateLimiter();
    for (let i = 0; i < 10; i += 1) {
      await limiter.recordFailure('1.2.3.4', 'a@b.com');
    }
    expect(await limiter.tooManyFailures('5.6.7.8', 'a@b.com')).toBe(false);
  });
});
