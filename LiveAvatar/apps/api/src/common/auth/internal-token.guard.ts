import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors/app-error';

/**
 * Guards every agent-facing `/internal` route (LLD §5.9's general
 * `X-Internal-Token` rule, deferred by Phase 3 since no route needed it yet
 * — see Phase 3's decision-log item 6). The LiveKit webhook route is the
 * one exception: it authenticates via LiveKit's own HMAC signature
 * (`LiveKitClientAdapter.verifyWebhook`) instead, so this guard is applied
 * only to the new agent-facing controller, not `InternalController`.
 *
 * Constant-time comparison (`timingSafeEqual`) so a byte-by-byte early exit
 * cannot leak how many leading characters of the real token an attacker
 * guessed correctly.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  /**
   * @param context - HTTP execution context
   * @returns true when `X-Internal-Token` matches `INTERNAL_TOKEN`
   * @throws AppError AUTH_UNAUTHORIZED on a missing/mismatched token
   */
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const presented = req.headers['x-internal-token'];
    const expected = process.env.INTERNAL_TOKEN;

    if (!expected || typeof presented !== 'string' || !this.constantTimeEquals(presented, expected)) {
      throw AppError.unauthorized();
    }
    return true;
  }

  private constantTimeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    // Lengths differ -> compare bufA against itself so timing never varies
    // with the presented token's length, then still return false.
    if (bufA.length !== bufB.length) {
      timingSafeEqual(bufA, bufA);
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }
}
