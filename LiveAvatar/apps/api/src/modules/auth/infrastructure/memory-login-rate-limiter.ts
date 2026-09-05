import { Injectable } from '@nestjs/common';
import type { LoginRateLimiterPort } from '../domain/ports';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 10;

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-process login rate limiter (10 fails / 10 min / IP+email).
 * Production can swap in a Redis implementation behind the same port;
 * this implementation is fail-safe and is used when Redis is absent (tests).
 */
@Injectable()
export class MemoryLoginRateLimiter implements LoginRateLimiterPort {
  private readonly buckets = new Map<string, Bucket>();

  /**
   * @param ip - Client IP
   * @param email - Normalized email
   */
  async tooManyFailures(ip: string, email: string): Promise<boolean> {
    const bucket = this.buckets.get(this.key(ip, email));
    if (!bucket) {
      return false;
    }
    if (Date.now() > bucket.resetAt) {
      this.buckets.delete(this.key(ip, email));
      return false;
    }
    return bucket.count >= MAX_FAILURES;
  }

  /**
   * @param ip - Client IP
   * @param email - Normalized email
   */
  async recordFailure(ip: string, email: string): Promise<void> {
    const k = this.key(ip, email);
    const now = Date.now();
    const existing = this.buckets.get(k);
    if (!existing || now > existing.resetAt) {
      this.buckets.set(k, { count: 1, resetAt: now + WINDOW_MS });
      return;
    }
    existing.count += 1;
  }

  /**
   * @param ip - Client IP
   * @param email - Normalized email
   */
  async clear(ip: string, email: string): Promise<void> {
    this.buckets.delete(this.key(ip, email));
  }

  private key(ip: string, email: string): string {
    return `${ip}|${email}`;
  }
}
