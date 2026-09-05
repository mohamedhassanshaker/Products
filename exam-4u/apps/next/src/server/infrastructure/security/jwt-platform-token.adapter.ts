import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { logger } from '@/server/logging';
import { parseTtlToSeconds } from './ttl.util';

const PLATFORM_AUDIENCE = 'platform';
const PLATFORM_TOKEN_TYPE = 'platform-admin';
const TOKEN_ISSUER = 'examland';

export interface PlatformTokenClaims {
  adminId: string;
}

export interface IssuedPlatformToken {
  token: string;
  expiresInSeconds: number;
}

/** No `tenantId`/`tenantSlug`/roles claim — a Platform Admin has "a single implicit super-scope" and
 * is never tenant-scoped (ported verbatim design note from legacy). */
export interface DecodedPlatformToken {
  adminId: string;
  jti: string;
  issuedAt: number;
  expiresAt: number;
}

/**
 * The sole platform-realm JWT implementation — ported logic from
 * `legacy/api/src/infrastructure/security/jwt-platform-token.adapter.ts`'s `JwtPlatformTokenAdapter`.
 * Uses **`JWT_PLATFORM_SECRET`**, a deliberately different secret from the tenant realm's
 * `JWT_TENANT_SECRET` (`env.schema.ts` asserts they differ whenever both are set) — the first of the
 * three realm-separation barriers (secret, then `aud`, then `typ`).
 *
 * Same "no `implements PlatformAdminTokenPort`" judgment call as
 * {@link import('./jwt-tenant-token.adapter').JwtTenantTokenAdapter} — see that file's header comment.
 */
export class JwtPlatformTokenAdapter {
  constructor(
    private readonly secret: string | undefined,
    private readonly ttlSpec: string,
  ) {}

  /** @throws Error (plain, not `DomainError`) if `JWT_PLATFORM_SECRET` is unset. */
  async issue(claims: PlatformTokenClaims): Promise<IssuedPlatformToken> {
    if (!this.secret) {
      throw new Error('JWT_PLATFORM_SECRET is not configured; cannot issue platform tokens.');
    }
    const expiresInSeconds = parseTtlToSeconds(this.ttlSpec);
    const key = new TextEncoder().encode(this.secret);
    const token = await new SignJWT({ typ: PLATFORM_TOKEN_TYPE })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.adminId)
      .setAudience(PLATFORM_AUDIENCE)
      .setIssuer(TOKEN_ISSUER)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
      .sign(key);
    return { token, expiresInSeconds };
  }

  /** Never throws — collapses every failure mode to `null`, identical contract to the tenant-realm
   * adapter's `verify()`. */
  async verify(token: string): Promise<DecodedPlatformToken | null> {
    if (!this.secret) {
      logger.warn('jwt_platform_secret_not_configured');
      return null;
    }
    try {
      const key = new TextEncoder().encode(this.secret);
      const { payload } = await jwtVerify(token, key, { audience: PLATFORM_AUDIENCE, issuer: TOKEN_ISSUER, algorithms: ['HS256'] });
      if (payload.typ !== PLATFORM_TOKEN_TYPE || typeof payload.sub !== 'string') {
        return null;
      }
      return {
        adminId: payload.sub,
        jti: typeof payload.jti === 'string' ? payload.jti : '',
        issuedAt: typeof payload.iat === 'number' ? payload.iat : 0,
        expiresAt: typeof payload.exp === 'number' ? payload.exp : 0,
      };
    } catch {
      return null;
    }
  }
}
