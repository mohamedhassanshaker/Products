import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers';
import { DASHBOARD_STATS_REPOSITORY } from './domain/ports';
import { PrismaDashboardStatsRepository } from './infrastructure/prisma-dashboard-stats.repository';
import { GetDashboardSummaryUseCase } from './application/get-dashboard-summary.use-case';
import { GetProviderHealthUseCase } from './application/get-provider-health.use-case';
import { DashboardController } from './interface/dashboard.controller';

/**
 * Dashboard bounded context (FR-DASH-1/2, Screen 1). Read-only — owns no
 * writes of its own. Depends one-directionally on `ProvidersModule` (catalog
 * + credential probe reads for the health grid); session-aggregate reads are
 * a direct Prisma projection owned here (a dedicated `DashboardStatsRepositoryPort`,
 * not a reuse of `session-logs`'s paginated search — different shape,
 * different consumer).
 */
@Module({
  imports: [ProvidersModule],
  controllers: [DashboardController],
  providers: [
    { provide: DASHBOARD_STATS_REPOSITORY, useClass: PrismaDashboardStatsRepository },
    GetDashboardSummaryUseCase,
    GetProviderHealthUseCase,
  ],
})
export class DashboardModule {}
