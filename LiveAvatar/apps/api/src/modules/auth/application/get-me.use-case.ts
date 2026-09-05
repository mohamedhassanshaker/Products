import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { ADMIN_USER_REPOSITORY, type AdminUserRepositoryPort } from '../domain/ports';
import { toUserDto } from './token-pair';

/**
 * Reloads the current admin from persistence so role/tenant changes apply
 * without waiting for token expiry.
 */
@Injectable()
export class GetMeUseCase {
  constructor(@Inject(ADMIN_USER_REPOSITORY) private readonly users: AdminUserRepositoryPort) {}

  /**
   * @param actor - JWT principal
   * @returns Fresh user DTO
   */
  async execute(actor: AdminActor) {
    const user = await this.users.findById(actor.id);
    if (!user || user.disabled) {
      throw AppError.unauthorized();
    }
    return toUserDto(user);
  }
}
