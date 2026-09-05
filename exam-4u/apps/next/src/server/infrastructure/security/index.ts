import { BcryptPasswordHasherAdapter } from './bcrypt-password-hasher.adapter';
import { JwtTenantTokenAdapter } from './jwt-tenant-token.adapter';
import { JwtPlatformTokenAdapter } from './jwt-platform-token.adapter';
import { GoogleIdTokenVerifierAdapter } from './google-id-token-verifier.adapter';

export { BcryptPasswordHasherAdapter, JwtTenantTokenAdapter, JwtPlatformTokenAdapter, GoogleIdTokenVerifierAdapter };
export type { TenantTokenClaims, IssuedTenantToken, DecodedTenantToken } from './jwt-tenant-token.adapter';
export type { PlatformTokenClaims, IssuedPlatformToken, DecodedPlatformToken } from './jwt-platform-token.adapter';
export type { VerifiedGoogleIdentity } from './google-id-token-verifier.adapter';

/**
 * `server/infrastructure/security`'s public barrel (Phase 1 sub-slice 1b) — the concrete
 * `bcrypt`/`jose`/`google-auth-library` adapters both auth realms depend on. Nothing outside this
 * module may import `./bcrypt-password-hasher.adapter`/`./jwt-tenant-token.adapter`/
 * `./jwt-platform-token.adapter`/`./google-id-token-verifier.adapter`/`./ttl.util` directly (enforced
 * by `apps/next/.eslintrc.cjs`'s `infrastructure/security` module-boundary rule) — mirrors legacy's
 * `infrastructure/security/**` layout exactly (both JWT adapters + the bcrypt adapter lived together
 * there too), rather than splitting one adapter per consuming realm.
 */
