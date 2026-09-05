import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { UpdateResidencyRequestSchema, type UpdateResidencyRequest } from '@liveavatar/contracts';
import { TypeBoxValidationPipe } from '../../../common/validation/typebox-pipe';
import { AdminJwtGuard } from '../../../common/auth/admin-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { IfMatch } from '../../../common/http/if-match.decorator';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { GetResidencyUseCase } from '../application/get-residency.use-case';
import { UpdateResidencyUseCase } from '../application/update-residency.use-case';

/** Data residency / privacy settings surface (LLD §5.6, Screen 8). */
@Controller('tenants/:id/residency')
@UseGuards(AdminJwtGuard, RolesGuard)
export class ResidencyController {
  constructor(
    private readonly getResidency: GetResidencyUseCase,
    private readonly updateResidency: UpdateResidencyUseCase,
  ) {}

  /** GET /api/tenants/:id/residency */
  @Get()
  get(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string) {
    return this.getResidency.execute(actor, tenantId);
  }

  /** PUT /api/tenants/:id/residency */
  @Put()
  update(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Body(new TypeBoxValidationPipe(UpdateResidencyRequestSchema, 'CONFIG_RETENTION_INVALID')) body: UpdateResidencyRequest,
    @IfMatch() ifMatch: string,
  ) {
    return this.updateResidency.execute(actor, tenantId, body, ifMatch);
  }
}
