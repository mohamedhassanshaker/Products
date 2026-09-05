import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import {
  ADMIN_USER_REPOSITORY,
  PASSWORD_HASHER,
  REFRESH_TOKEN_REPOSITORY,
  TOKEN_DIGEST,
  TOKEN_SIGNER,
  assertPasswordPolicy,
  issueTokenPair,
  toUserDto,
  type AdminUserRepositoryPort,
  type PasswordHasherPort,
  type RefreshTokenRepositoryPort,
  type TokenDigestPort,
  type TokenSignerPort,
} from '../../auth';
import { INVITE_REPOSITORY, type InviteRepositoryPort } from '../domain/ports';

/**
 * Accepts an invite token and creates the admin user (FR-AUTH-3).
 */
@Injectable()
export class AcceptInviteUseCase {
  constructor(
    @Inject(INVITE_REPOSITORY) private readonly invites: InviteRepositoryPort,
    @Inject(ADMIN_USER_REPOSITORY) private readonly users: AdminUserRepositoryPort,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
    @Inject(TOKEN_SIGNER) private readonly signer: TokenSignerPort,
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refresh: RefreshTokenRepositoryPort,
    @Inject(TOKEN_DIGEST) private readonly digest: TokenDigestPort,
  ) {}

  /**
   * @param input - Token + password
   * @returns Session pair identical to login
   */
  async execute(input: { token: string; password: string }) {
    assertPasswordPolicy(input.password);
    const invite = await this.invites.findByTokenHash(this.digest.digest(input.token));
    if (!invite || invite.acceptedAt || invite.expiresAt.getTime() <= Date.now()) {
      throw AppError.badRequest('AUTH_INVITE_INVALID');
    }
    if (await this.users.emailExists(invite.email)) {
      throw AppError.conflict('AUTH_EMAIL_EXISTS');
    }
    const user = await this.users.create({
      email: invite.email,
      passwordHash: await this.hasher.hash(input.password),
      roles: invite.roles,
      tenantIds: invite.roles.includes('operator') ? [] : invite.tenantIds,
    });
    await this.invites.markAccepted(invite.id);
    const pair = await issueTokenPair(user, this.signer, this.refresh, this.digest);
    return { ...pair, user: toUserDto(user) };
  }
}
