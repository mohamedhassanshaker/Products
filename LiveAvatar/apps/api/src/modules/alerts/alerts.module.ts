import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants';
import { DeploymentConfigModule } from '../deployment-config';
import { SessionsModule } from '../sessions';
import { ALERT_POLICY_REPOSITORY } from './domain/ports';
import { PrismaAlertPolicyRepository } from './infrastructure/prisma-alert-policy.repository';
import { GetAlertPolicyUseCase } from './application/get-alert-policy.use-case';
import { UpdateAlertPolicyUseCase } from './application/update-alert-policy.use-case';
import { ListAlertsUseCase } from './application/list-alerts.use-case';
import { GetFailoverStatsUseCase } from './application/get-failover-stats.use-case';
import { AlertsController } from './interface/alerts.controller';

/**
 * Alerts & failover bounded context (FR-ALERT-1..4, Screen 7). Depends
 * one-directionally on `TenantsModule` (access checks), `DeploymentConfigModule`
 * (read-only projection of the fallback LLM Agent Builder owns), and
 * `SessionsModule` (the already-existing `AlertEvent`/`LatencyHop` read ports
 * — this module owns none of that persistence itself, per the telemetry-ports
 * docstring's own forward note).
 */
@Module({
  imports: [TenantsModule, DeploymentConfigModule, SessionsModule],
  controllers: [AlertsController],
  providers: [
    { provide: ALERT_POLICY_REPOSITORY, useClass: PrismaAlertPolicyRepository },
    GetAlertPolicyUseCase,
    UpdateAlertPolicyUseCase,
    ListAlertsUseCase,
    GetFailoverStatsUseCase,
  ],
})
export class AlertsModule {}
