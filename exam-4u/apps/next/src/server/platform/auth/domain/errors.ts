import { DomainError } from '@/server/common/errors/domain-error';

/**
 * Enumeration-safe: thrown identically for an unknown email, a wrong password, and a correct password
 * on a `isActive === false` admin — none distinguishable to the caller. Ported verbatim from
 * `legacy/api/src/platform/auth/domain/errors.ts`. Deliberately reuses the same `INVALID_CREDENTIALS`
 * code as the tenant realm's `InvalidCredentialsError` (same client-facing semantics, two separate
 * classes only because they live in two separate, non-cross-importing modules).
 */
export class PlatformInvalidCredentialsError extends DomainError {
  constructor() {
    super('INVALID_CREDENTIALS', 'Invalid email or password.');
  }
}
