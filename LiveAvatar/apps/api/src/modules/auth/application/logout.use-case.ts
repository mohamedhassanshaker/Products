import { Inject, Injectable } from '@nestjs/common';
import {
  REFRESH_TOKEN_REPOSITORY,
  TOKEN_DIGEST,
  type RefreshTokenRepositoryPort,
  type TokenDigestPort,
} from '../domain/ports';

/**
 * Revokes the refresh-token family (FR-AUTH-2). Missing tokens are a no-op
 * so logout is idempotent from the client's point of view.
 */
@Injectable()
export class LogoutUseCase {
  constructor(
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refresh: RefreshTokenRepositoryPort,
    @Inject(TOKEN_DIGEST) private readonly digest: TokenDigestPort,
  ) {}

  /**
   * @param refreshToken - Opaque token; ignored when unknown
   */
  async execute(refreshToken: string): Promise<void> {
    const stored = await this.refresh.findByHash(this.digest.digest(refreshToken));
    if (stored) {
      await this.refresh.revokeFamily(stored.familyId);
    }
  }
}
