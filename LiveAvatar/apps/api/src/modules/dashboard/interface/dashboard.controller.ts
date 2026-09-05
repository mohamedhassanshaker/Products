import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardSummaryQuerySchema, type DashboardSummaryQuery } from '@liveavatar/contracts';
import { TypeBoxValidationPipe } from '../../../common/validation/typebox-pipe';
import { AdminJwtGuard } from '../../../common/auth/admin-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { GetDashboardSummaryUseCase } from '../application/get-dashboard-summary.use-case';
import { GetProviderHealthUseCase } from '../application/get-provider-health.use-case';

/** Dashboard surface (LLD §5.7, Screen 1). */
@Controller('dashboard')
@UseGuards(AdminJwtGuard, RolesGuard)
export class DashboardController {
  constructor(
    private readonly getSummary: GetDashboardSummaryUseCase,
    private readonly getProviderHealth: GetProviderHealthUseCase,
  ) {}

  /** GET /api/dashboard/summary */
  @Get('summary')
  summary(
    @CurrentUser() actor: AdminActor,
    @Query(new TypeBoxValidationPipe(DashboardSummaryQuerySchema, 'RANGE_INVALID')) query: DashboardSummaryQuery,
  ) {
    return this.getSummary.execute(actor, query);
  }

  /** GET /api/dashboard/provider-health */
  @Get('provider-health')
  providerHealth() {
    return this.getProviderHealth.execute();
  }
}
