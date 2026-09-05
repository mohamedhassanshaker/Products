import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.token';
import { PROBE_RATE_LIMIT_PER_MINUTE } from '../domain/provider';
import type { ProbeRateLimiterPort } from '../domain/ports';

/**
 * Fixed 60s-window counter per tenant (FR-PROVIDER-3: 30/tenant/min). Backed
 * by Redis (not in-memory) so the limit holds across the multiple `web`
 * replicas the ADR's deployment topology allows.
 */
@Injectable()
export class RedisProbeRateLimiter implements ProbeRateLimiterPort {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** @param tenantId - Tenant making the probe call */
  async tryConsume(tenantId: string): Promise<boolean> {
    const bucket = Math.floor(Date.now() / 60_000);
    const key = `probe-rate:${tenantId}:${bucket}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, 60);
    }
    return count <= PROBE_RATE_LIMIT_PER_MINUTE;
  }
}
