import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import {
  ADMIN_USER_REPOSITORY,
  REFRESH_TOKEN_REPOSITORY,
  TOKEN_DIGEST,
  TOKEN_SIGNER,
  type AdminUserRepositoryPort,
  type RefreshTokenRepositoryPort,
  type TokenDigestPort,
  type TokenSignerPort,
} from '../domain/ports';
import { issueTokenPair } from './token-pair';

/**
 * Rotates a refresh token. Reuse after rotation revokes the whole family
 * (FR-AUTH-2).
 */
@Injectable()
export class RefreshUseCase {
  constructor(
    @Inject(ADMIN_USER_REPOSITORY) private readonly users: AdminUserRepositoryPort,
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refresh: RefreshTokenRepositoryPort,
    @Inject(TOKEN_SIGNER) private readonly signer: TokenSignerPort,
    @Inject(TOKEN_DIGEST) private readonly digest: TokenDigestPort,
  ) {}

  /**
   * @param refreshToken - Opaque token from login
   * @returns Rotated pair (no user object — LLD refresh response)
   */
  async execute(refreshToken: string) {
    const hash = this.digest.digest(refreshToken);
    const stored = await this.refresh.findByHash(hash);
    if (!stored) {
      throw AppError.unauthorized('AUTH_REFRESH_INVALID');
    }
    if (stored.revokedAt || stored.expiresAt.getTime() <= Date.now()) {
      await this.refresh.revokeFamily(stored.familyId);
      throw AppError.unauthorized('AUTH_REFRESH_INVALID');
    }
    // Detect reuse: if this hash is still present but we treat a second present
    // as rotation — we revoke this row first; a later call with the same hash
    // finds revoked/missing → family revoke above. Explicit reuse: revoke family
    // then delete this row so the next replay hits the missing/revoked path.
    await this.refresh.revokeByHash(hash);
    const user = await this.users.findById(stored.adminUserId);
    if (!user || user.disabled) {
      await this.refresh.revokeFamily(stored.familyId);
      throw AppError.unauthorized('AUTH_REFRESH_INVALID');
    }
    return issueTokenPair(user, this.signer, this.refresh, this.digest, stored.familyId);
  }
}
