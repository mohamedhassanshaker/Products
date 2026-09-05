import type Redis from 'ioredis';
import { RedisClientShutdown } from './redis-client-shutdown.provider';

describe('RedisClientShutdown', () => {
  it('gracefully quits the client on module destroy', async () => {
    const client = { quit: jest.fn().mockResolvedValue('OK'), disconnect: jest.fn() } as unknown as Redis;
    const shutdown = new RedisClientShutdown(client);

    await shutdown.onModuleDestroy();

    expect(client.quit).toHaveBeenCalledTimes(1);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('falls back to a hard disconnect when quit() rejects (e.g. the connection never finished connecting)', async () => {
    const client = {
      quit: jest.fn().mockRejectedValue(new Error('Connection is closed.')),
      disconnect: jest.fn(),
    } as unknown as Redis;
    const shutdown = new RedisClientShutdown(client);

    await shutdown.onModuleDestroy();

    expect(client.quit).toHaveBeenCalledTimes(1);
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });
});
