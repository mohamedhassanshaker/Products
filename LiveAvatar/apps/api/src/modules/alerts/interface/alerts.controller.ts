import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import {
  FailoverStatsQuerySchema,
  ListAlertsQuerySchema,
  UpdateAlertPolicyRequestSchema,
  type FailoverStatsQuery,
  type ListAlertsQuery,
  type UpdateAlertPolicyRequest,
} from '@liveavatar/contracts';
import { TypeBoxValidationPipe } from '../../../common/validation/typebox-pipe';
import { AdminJwtGuard } from '../../../common/auth/admin-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { IfMatch } from '../../../common/http/if-match.decorator';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { GetAlertPolicyUseCase } from '../application/get-alert-policy.use-case';
import { UpdateAlertPolicyUseCase } from '../application/update-alert-policy.use-case';
import { ListAlertsUseCase } from '../application/list-alerts.use-case';
import { GetFailoverStatsUseCase } from '../application/get-failover-stats.use-case';

/** Alerts & failover surface (LLD §5.6, Screen 7). */
@Controller('tenants/:id')
@UseGuards(AdminJwtGuard, RolesGuard)
export class AlertsController {
  constructor(
    private readonly getAlertPolicy: GetAlertPolicyUseCase,
    private readonly updateAlertPolicy: UpdateAlertPolicyUseCase,
    private readonly listAlerts: ListAlertsUseCase,
    private readonly getFailoverStats: GetFailoverStatsUseCase,
  ) {}

  /** GET /api/tenants/:id/alert-policy */
  @Get('alert-policy')
  policy(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string) {
    return this.getAlertPolicy.execute(actor, tenantId);
  }

  /** PUT /api/tenants/:id/alert-policy */
  @Put('alert-policy')
  updatePolicy(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Body(new TypeBoxValidationPipe(UpdateAlertPolicyRequestSchema, 'CONFIG_RETRY_INVALID')) body: UpdateAlertPolicyRequest,
    @IfMatch() ifMatch: string,
  ) {
    return this.updateAlertPolicy.execute(actor, tenantId, body, ifMatch);
  }

  /** GET /api/tenants/:id/alerts */
  @Get('alerts')
  list(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Query(new TypeBoxValidationPipe(ListAlertsQuerySchema, 'SESS_RANGE_INVALID')) query: ListAlertsQuery,
  ) {
    return this.listAlerts.execute(actor, tenantId, query);
  }

  /** GET /api/tenants/:id/failover-stats */
  @Get('failover-stats')
  failoverStats(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Query(new TypeBoxValidationPipe(FailoverStatsQuerySchema, 'RANGE_INVALID')) query: FailoverStatsQuery,
  ) {
    return this.getFailoverStats.execute(actor, tenantId, query);
  }
}
