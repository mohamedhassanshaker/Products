import { Inject, Injectable } from '@nestjs/common';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { INVITE_REPOSITORY, type InviteRepositoryPort } from '../domain/ports';

/**
 * Lists invites. Operators see all; admins see invites they created that
 * target their assigned tenants (or all they created — Phase 1: all rows
 * they created plus any targeting their tenants).
 */
@Injectable()
export class ListInvitesUseCase {
  constructor(@Inject(INVITE_REPOSITORY) private readonly invites: InviteRepositoryPort) {}

  /**
   * @param _actor - Current admin (reserved for later tenant scoping)
   * @param query - Optional status=pending|accepted and page
   */
  async execute(_actor: AdminActor, query: { status?: string; page?: number }) {
    const page = query.page && query.page >= 1 ? query.page : 1;
    const pendingOnly = query.status === 'pending';
    const { items, total } = await this.invites.list({
      page,
      pageSize: 25,
      pendingOnly,
    });
    return {
      items: items.map((row) => ({
        id: row.id,
        email: row.email,
        roles: row.roles,
        tenant_ids: row.tenantIds,
        expires_at: row.expiresAt.toISOString(),
        accepted_at: row.acceptedAt?.toISOString() ?? null,
        created_at: row.createdAt.toISOString(),
      })),
      total,
    };
  }
}
