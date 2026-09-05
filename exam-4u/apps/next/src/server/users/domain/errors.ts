import { DomainError } from '@/server/common/errors/domain-error';

/**
 * `users`-module `DomainError` subclasses — ported verbatim from
 * `legacy/api/src/modules/users/domain/errors.ts`. Declared independently here (not imported from
 * `auth`) even though `EMAIL_ALREADY_REGISTERED`/`WEAK_PASSWORD` are the identical codes `auth` also
 * throws — keeps each module's domain layer self-contained, matching legacy's own convention.
 */

/** FR-IAM-7: no `user` row with the given id in the resolved tenant's schema. */
export class UserNotFoundError extends DomainError {
  constructor() {
    super('USER_NOT_FOUND', 'No such user.');
  }
}

/** FR-IAM-7 (admin create): per-tenant email uniqueness violation — the same rule/code `auth`'s
 * self-registration path enforces, applied here to admin-initiated creation. */
export class AdminEmailAlreadyRegisteredError extends DomainError {
  constructor() {
    super('EMAIL_ALREADY_REGISTERED', 'An account with this email already exists.');
  }
}

/** FR-IAM-7 (admin create/reset): an admin-supplied temporary password fails the tenant's configured
 * strength policy. */
export class AdminWeakPasswordError extends DomainError {
  constructor(violations: string[]) {
    super('WEAK_PASSWORD', violations[0] ?? 'Password does not meet the minimum strength policy.', { violations });
  }
}
