import { Module } from '@nestjs/common';
import { INVITE_REPOSITORY } from './domain/ports';
import { CreateInviteUseCase } from './application/create-invite.use-case';
import { ListInvitesUseCase } from './application/list-invites.use-case';
import { RevokeInviteUseCase } from './application/revoke-invite.use-case';
import { AcceptInviteUseCase } from './application/accept-invite.use-case';
import { PrismaInviteRepository } from './infrastructure/prisma-invite.repository';
import { InviteController } from './interface/invite.controller';

/**
 * Admin-user invites (FR-AUTH-3). Auth ports come from the global AuthModule.
 */
@Module({
  controllers: [InviteController],
  providers: [
    CreateInviteUseCase,
    ListInvitesUseCase,
    RevokeInviteUseCase,
    AcceptInviteUseCase,
    PrismaInviteRepository,
    { provide: INVITE_REPOSITORY, useExisting: PrismaInviteRepository },
  ],
  exports: [CreateInviteUseCase, AcceptInviteUseCase],
})
export class AdminUsersModule {}
