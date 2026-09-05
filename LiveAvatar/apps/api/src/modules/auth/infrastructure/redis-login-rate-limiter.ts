import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { LoginRateLimiterPort } from '../domain/ports';
import { MemoryLoginRateLimiter } from './memory-login-rate-limiter';

const WINDOW_SEC = 10 * 60;
const MAX_FAILURES = 10;

/**
 * Redis-backed login rate limiter with in-memory fallback when Redis is
 * unavailable (fail-safe: we still limit, we just do it locally).
 */
@Injectable()
export class RedisLoginRateLimiter implements LoginRateLimiterPort, OnModuleDestroy {
  private readonly logger = new Logger(RedisLoginRateLimiter.name);
  private redis: Redis | null = null;
  private readonly memory = new MemoryLoginRateLimiter();

  constructor() {
    const url = process.env.REDIS_URL;
    if (url) {
      try {
        this.redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
        this.redis.on('error', (err) => {
          this.logger.warn({ err }, 'Redis rate-limit error; using memory fallback');
        });
        void this.redis.connect().catch(() => {
          this.redis = null;
        });
      } catch {
        this.redis = null;
      }
    }
  }

  /** Disconnects Redis if it was opened. */
  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      this.redis.disconnect();
    }
  }

  /**
   * @param ip - Client IP
   * @param email - Normalized email
   */
  async tooManyFailures(ip: string, email: string): Promise<boolean> {
    if (!this.redis) {
      return this.memory.tooManyFailures(ip, email);
    }
    try {
      const count = await this.redis.get(this.key(ip, email));
      return Number(count ?? 0) >= MAX_FAILURES;
    } catch {
      return this.memory.tooManyFailures(ip, email);
    }
  }

  /**
   * @param ip - Client IP
   * @param email - Normalized email
   */
  async recordFailure(ip: string, email: string): Promise<void> {
    if (!this.redis) {
      await this.memory.recordFailure(ip, email);
      return;
    }
    try {
      const k = this.key(ip, email);
      const count = await this.redis.incr(k);
      if (count === 1) {
        await this.redis.expire(k, WINDOW_SEC);
      }
    } catch {
      await this.memory.recordFailure(ip, email);
    }
  }

  /**
   * @param ip - Client IP
   * @param email - Normalized email
   */
  async clear(ip: string, email: string): Promise<void> {
    if (!this.redis) {
      await this.memory.clear(ip, email);
      return;
    }
    try {
      await this.redis.del(this.key(ip, email));
    } catch {
      await this.memory.clear(ip, email);
    }
  }

  private key(ip: string, email: string): string {
    return `login_fail:${ip}:${email}`;
  }
}
