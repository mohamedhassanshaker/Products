import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { isOperator } from '../../../common/auth/admin-actor';
import { INVITE_REPOSITORY, type InviteRepositoryPort } from '../domain/ports';

/**
 * Deletes a pending invite. Unknown/accepted ids → AUTH_INVITE_INVALID 404.
 */
@Injectable()
export class RevokeInviteUseCase {
  constructor(@Inject(INVITE_REPOSITORY) private readonly invites: InviteRepositoryPort) {}

  /**
   * @param actor - Current admin
   * @param id - Invite id
   */
  async execute(actor: AdminActor, id: string): Promise<void> {
    const invite = await this.invites.findById(id);
    if (!invite || invite.acceptedAt) {
      throw AppError.notFound('AUTH_INVITE_INVALID');
    }
    if (!isOperator(actor) && invite.createdBy !== actor.id) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    await this.invites.delete(id);
  }
}
