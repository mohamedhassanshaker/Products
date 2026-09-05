import RedisImport from 'ioredis';
import { RedisLoginRateLimiter } from './redis-login-rate-limiter';

jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

const Redis = RedisImport as unknown as jest.Mock;

function makeFakeRedisInstance() {
  return {
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    del: jest.fn(),
    disconnect: jest.fn(),
  };
}

describe('RedisLoginRateLimiter', () => {
  const prevUrl = process.env.REDIS_URL;

  afterEach(() => {
    process.env.REDIS_URL = prevUrl;
    Redis.mockReset();
  });

  it('falls back to the in-memory limiter when REDIS_URL is unset', async () => {
    delete process.env.REDIS_URL;
    const limiter = new RedisLoginRateLimiter();
    expect(await limiter.tooManyFailures('1.2.3.4', 'a@b.com')).toBe(false);
    await limiter.recordFailure('1.2.3.4', 'a@b.com');
    await limiter.clear('1.2.3.4', 'a@b.com');
    await limiter.onModuleDestroy();
  });

  it('falls back to memory when the Redis constructor throws', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    Redis.mockImplementation(() => {
      throw new Error('boom');
    });
    const limiter = new RedisLoginRateLimiter();
    expect(await limiter.tooManyFailures('1.2.3.4', 'a@b.com')).toBe(false);
  });

  it('uses Redis get/incr/expire/del when connected', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const instance = makeFakeRedisInstance();
    Redis.mockImplementation(() => instance);
    instance.get.mockResolvedValue('11');
    instance.incr.mockResolvedValue(1);

    const limiter = new RedisLoginRateLimiter();
    await flush();

    expect(await limiter.tooManyFailures('1.2.3.4', 'a@b.com')).toBe(true);
    await limiter.recordFailure('1.2.3.4', 'a@b.com');
    expect(instance.expire).toHaveBeenCalled();
    await limiter.clear('1.2.3.4', 'a@b.com');
    expect(instance.del).toHaveBeenCalled();
    await limiter.onModuleDestroy();
    expect(instance.disconnect).toHaveBeenCalled();
  });

  it('does not re-expire on a non-first increment', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const instance = makeFakeRedisInstance();
    Redis.mockImplementation(() => instance);
    instance.incr.mockResolvedValue(2);
    const limiter = new RedisLoginRateLimiter();
    await flush();
    await limiter.recordFailure('1.2.3.4', 'a@b.com');
    expect(instance.expire).not.toHaveBeenCalled();
  });

  it('falls back to memory when a Redis call rejects', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const instance = makeFakeRedisInstance();
    Redis.mockImplementation(() => instance);
    instance.get.mockRejectedValue(new Error('down'));
    instance.incr.mockRejectedValue(new Error('down'));
    instance.del.mockRejectedValue(new Error('down'));
    const limiter = new RedisLoginRateLimiter();
    await flush();
    expect(await limiter.tooManyFailures('1.2.3.4', 'a@b.com')).toBe(false);
    await limiter.recordFailure('1.2.3.4', 'a@b.com');
    await limiter.clear('1.2.3.4', 'a@b.com');
  });

  it('falls back to memory when redis.connect() rejects', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const instance = makeFakeRedisInstance();
    instance.connect.mockRejectedValue(new Error('unreachable'));
    Redis.mockImplementation(() => instance);
    const limiter = new RedisLoginRateLimiter();
    await flush();
    expect(await limiter.tooManyFailures('1.2.3.4', 'a@b.com')).toBe(false);
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
