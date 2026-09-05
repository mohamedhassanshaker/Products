import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.token';
import { RedisClientShutdown } from './redis-client-shutdown.provider';

/**
 * Single shared ioredis connection for the whole process (rate limiting,
 * BullMQ). `@Global` so any module can `@Inject(REDIS_CLIENT)` without
 * re-importing this module everywhere (LLD §8.7/§8.8 both need it).
 *
 * `RedisClientShutdown` (Final Review D-9) closes this connection on
 * `app.close()` — see that provider's own doc comment for why this was
 * previously missing and what it broke.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
        // BullMQ requires maxRetriesPerRequest: null on any connection it shares.
        return new Redis(url, { maxRetriesPerRequest: null });
      },
    },
    RedisClientShutdown,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
