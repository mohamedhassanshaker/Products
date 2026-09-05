import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminIdentity } from '../domain/admin-identity';
import {
  ADMIN_USER_REPOSITORY,
  LOGIN_RATE_LIMITER,
  PASSWORD_HASHER,
  REFRESH_TOKEN_REPOSITORY,
  TOKEN_DIGEST,
  TOKEN_SIGNER,
  type AdminUserRepositoryPort,
  type LoginRateLimiterPort,
  type PasswordHasherPort,
  type RefreshTokenRepositoryPort,
  type TokenDigestPort,
  type TokenSignerPort,
} from '../domain/ports';
import { normalizeEmail } from '../domain/validation';
import { issueTokenPair, toUserDto } from './token-pair';

/**
 * Authenticates an admin (FR-AUTH-1). Unknown email and wrong password share
 * AUTH_INVALID_CREDENTIALS. Disabled users get AUTH_USER_DISABLED without
 * revealing whether the password was correct after the user is found disabled.
 */
@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(ADMIN_USER_REPOSITORY) private readonly users: AdminUserRepositoryPort,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
    @Inject(TOKEN_SIGNER) private readonly signer: TokenSignerPort,
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refresh: RefreshTokenRepositoryPort,
    @Inject(TOKEN_DIGEST) private readonly digest: TokenDigestPort,
    @Inject(LOGIN_RATE_LIMITER) private readonly limiter: LoginRateLimiterPort,
  ) {}

  /**
   * @param input - Email + password
   * @param ip - Client IP for the rate-limit key
   * @returns Token pair + user
   */
  async execute(input: { email: string; password: string }, ip: string) {
    const email = normalizeEmail(input.email);
    if (await this.limiter.tooManyFailures(ip, email)) {
      throw AppError.tooMany('AUTH_RATE_LIMITED');
    }
    const user = await this.users.findByEmail(email);
    if (!user) {
      await this.limiter.recordFailure(ip, email);
      throw AppError.unauthorized('AUTH_INVALID_CREDENTIALS');
    }
    const ok = await this.hasher.verify(user.passwordHash, input.password);
    if (!ok) {
      await this.limiter.recordFailure(ip, email);
      throw AppError.unauthorized('AUTH_INVALID_CREDENTIALS');
    }
    if (user.disabled) {
      throw AppError.forbidden('AUTH_USER_DISABLED');
    }
    await this.limiter.clear(ip, email);
    return this.issue(user);
  }

  /**
   * Issues a fresh access/refresh pair for an already-authenticated identity.
   * @param user - Valid admin
   */
  async issue(user: AdminIdentity) {
    const pair = await issueTokenPair(user, this.signer, this.refresh, this.digest);
    return { ...pair, user: toUserDto(user) };
  }
}
