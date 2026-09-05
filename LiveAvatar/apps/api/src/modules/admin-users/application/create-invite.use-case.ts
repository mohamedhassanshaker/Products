import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant, isOperator } from '../../../common/auth/admin-actor';
import {
  ADMIN_USER_REPOSITORY,
  TOKEN_DIGEST,
  type AdminUserRepositoryPort,
  type TokenDigestPort,
} from '../../auth';
import { normalizeEmail } from '../../auth';
import { INVITE_REPOSITORY, type InviteRepositoryPort } from '../domain/ports';

const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * Creates an invite (FR-AUTH-3). Operators may grant operator; admins may
 * only invite admins to tenants they are assigned to.
 */
@Injectable()
export class CreateInviteUseCase {
  constructor(
    @Inject(INVITE_REPOSITORY) private readonly invites: InviteRepositoryPort,
    @Inject(ADMIN_USER_REPOSITORY) private readonly users: AdminUserRepositoryPort,
    @Inject(TOKEN_DIGEST) private readonly digest: TokenDigestPort,
  ) {}

  /**
   * @param actor - Inviting admin
   * @param input - Email, roles, tenant ids
   */
  async execute(
    actor: AdminActor,
    input: { email: string; roles: string[]; tenant_ids: string[] },
  ) {
    const email = normalizeEmail(input.email);
    const roles = input.roles;
    if (roles.includes('operator') && !isOperator(actor)) {
      throw AppError.forbidden('AUTH_ROLE_FORBIDDEN');
    }
    if (!isOperator(actor)) {
      for (const tenantId of input.tenant_ids) {
        if (!canAccessTenant(actor, tenantId)) {
          throw AppError.forbidden('TENANT_FORBIDDEN');
        }
      }
    }
    if (await this.users.emailExists(email)) {
      throw AppError.conflict('AUTH_EMAIL_EXISTS');
    }
    const token = this.digest.randomToken();
    const record = await this.invites.create({
      email,
      roles,
      tokenHash: this.digest.digest(token),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      createdBy: actor.id,
      tenantIds: roles.includes('operator') ? [] : input.tenant_ids,
    });
    return {
      id: record.id,
      email: record.email,
      roles: record.roles,
      tenant_ids: record.tenantIds,
      expires_at: record.expiresAt.toISOString(),
      invite_token: token,
    };
  }
}
