import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.token';

/**
 * Closes the shared `REDIS_CLIENT` ioredis connection on `app.close()`.
 *
 * QA fix (Final Review D-9): this connection previously had no shutdown
 * wiring at all — unlike `RedisLoginRateLimiter`'s own private client (which
 * already disconnects in its own `onModuleDestroy`), nothing ever closed
 * this one. A live ioredis socket (plus its internal reconnect timer) keeps
 * the Node event loop alive after `app.close()` resolves, which is exactly
 * why `apps/api/test/tenant-isolation.e2e-spec.ts` passed its assertions but
 * Jest never exited on its own ("Jest did not exit one second after the
 * test run has completed") — the test's own `afterAll` correctly calls
 * `app.close()`, but that call had nothing to actually close here.
 *
 * Kept in its own file (not inline in `redis.module.ts`) so this logic is
 * covered by the project's coverage gate — `*.module.ts` files are excluded
 * from `collectCoverageFrom` in `jest.config.cjs`.
 */
@Injectable()
export class RedisClientShutdown implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  /**
   * Gracefully quits the client, falling back to a hard disconnect if the
   * connection is already in a bad state (e.g. it never finished connecting).
   */
  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
