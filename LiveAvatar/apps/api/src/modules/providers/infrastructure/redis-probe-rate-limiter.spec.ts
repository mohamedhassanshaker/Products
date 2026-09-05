import { RedisProbeRateLimiter } from './redis-probe-rate-limiter';

describe('RedisProbeRateLimiter', () => {
  it('allows the first 30 calls in a minute and blocks the 31st', async () => {
    const redis = { incr: jest.fn(), expire: jest.fn() };
    const limiter = new RedisProbeRateLimiter(redis as never);

    for (let i = 1; i <= 30; i += 1) {
      redis.incr.mockResolvedValueOnce(i);
      const allowed = await limiter.tryConsume('tenant-1');
      expect(allowed).toBe(true);
    }
    expect(redis.expire).toHaveBeenCalledTimes(1);

    redis.incr.mockResolvedValueOnce(31);
    const blocked = await limiter.tryConsume('tenant-1');
    expect(blocked).toBe(false);
  });
});
