import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AcceptInviteRequestSchema, CreateInviteRequestSchema } from '@liveavatar/contracts';
import { TypeBoxValidationPipe } from '../../../common/validation/typebox-pipe';
import { AdminJwtGuard } from '../../../common/auth/admin-jwt.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { CreateInviteUseCase } from '../application/create-invite.use-case';
import { ListInvitesUseCase } from '../application/list-invites.use-case';
import { RevokeInviteUseCase } from '../application/revoke-invite.use-case';
import { AcceptInviteUseCase } from '../application/accept-invite.use-case';

/**
 * Invite HTTP surface under /api/auth/invites (LLD §5.2).
 */
@Controller('auth/invites')
export class InviteController {
  constructor(
    private readonly createInvite: CreateInviteUseCase,
    private readonly listInvites: ListInvitesUseCase,
    private readonly revokeInvite: RevokeInviteUseCase,
    private readonly acceptInvite: AcceptInviteUseCase,
  ) {}

  /** POST /api/auth/invites */
  @Post()
  @UseGuards(AdminJwtGuard)
  @HttpCode(201)
  create(
    @CurrentUser() actor: AdminActor,
    @Body(new TypeBoxValidationPipe(CreateInviteRequestSchema, 'AUTH_INVITE_INVALID'))
    body: { email: string; roles: string[]; tenant_ids: string[] },
  ) {
    return this.createInvite.execute(actor, body);
  }

  /** GET /api/auth/invites */
  @Get()
  @UseGuards(AdminJwtGuard)
  list(
    @CurrentUser() actor: AdminActor,
    @Query('status') status?: string,
    @Query('page') page?: string,
  ) {
    return this.listInvites.execute(actor, { status, page: page ? Number(page) : 1 });
  }

  /** POST /api/auth/invites/accept */
  @Post('accept')
  @HttpCode(201)
  accept(
    @Body(new TypeBoxValidationPipe(AcceptInviteRequestSchema, 'AUTH_INVITE_INVALID'))
    body: { token: string; password: string },
  ) {
    return this.acceptInvite.execute(body);
  }

  /** DELETE /api/auth/invites/:id */
  @Delete(':id')
  @UseGuards(AdminJwtGuard)
  @HttpCode(204)
  async revoke(@CurrentUser() actor: AdminActor, @Param('id') id: string): Promise<void> {
    await this.revokeInvite.execute(actor, id);
  }
}
