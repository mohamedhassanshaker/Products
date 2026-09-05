import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import {
  ADMIN_USER_REPOSITORY,
  PASSWORD_HASHER,
  type AdminUserRepositoryPort,
  type PasswordHasherPort,
} from '../domain/ports';
import { assertPasswordPolicy, normalizeEmail } from '../domain/validation';

/**
 * One-time operator bootstrap (FR-AUTH-3). The bootstrap secret is checked
 * in the controller; this use case consumes it by creating the first operator
 * so a second call is AUTH_ALREADY_SEEDED.
 */
@Injectable()
export class SeedOperatorUseCase {
  constructor(
    @Inject(ADMIN_USER_REPOSITORY) private readonly users: AdminUserRepositoryPort,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
  ) {}

  /**
   * @param input - Email + password
   * @returns Created operator (no tokens — client must login)
   */
  async execute(input: { email: string; password: string }) {
    // Fast-path rejection so a well-formed request against an already-seeded
    // platform still gets a quick 409 without hashing a password first. The
    // *authoritative* one-time guarantee is enforced atomically below in
    // createFirstOperator (D-4) — this check alone is not race-safe.
    if ((await this.users.countOperators()) > 0) {
      throw AppError.conflict('AUTH_ALREADY_SEEDED');
    }
    const email = normalizeEmail(input.email);
    // Bootstrap has no invite in play, so a weak password must not surface
    // the invite-flow's error code (D-3) — use a bootstrap-appropriate one.
    assertPasswordPolicy(input.password, 'AUTH_PASSWORD_INVALID');
    if (await this.users.emailExists(email)) {
      throw AppError.conflict('AUTH_EMAIL_EXISTS');
    }
    const passwordHash = await this.hasher.hash(input.password);
    // Atomic count-then-create: closes the race between two concurrent seed
    // calls that could otherwise both pass the fast-path check above.
    const user = await this.users.createFirstOperator({ email, passwordHash });
    if (!user) {
      throw AppError.conflict('AUTH_ALREADY_SEEDED');
    }
    return { id: user.id, email: user.email, roles: user.roles };
  }
}
