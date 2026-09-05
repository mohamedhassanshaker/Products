import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { DashboardStatsRepositoryPort } from '../domain/ports';

/** Prisma cross-tenant aggregation reads for the Dashboard screen (FR-DASH-1). */
@Injectable()
export class PrismaDashboardStatsRepository implements DashboardStatsRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /** @inheritdoc */
  async countActiveTenants(tenantIds: string[] | null): Promise<number> {
    return this.prisma.db.tenant.count({
      where: { status: 'active', ...(tenantIds ? { id: { in: tenantIds } } : {}) },
    });
  }

  /** @inheritdoc */
  async countSessionsByOutcome(
    tenantIds: string[] | null,
    from: Date,
    to: Date,
  ): Promise<{ started: number; ended: number; failed: number; abandoned: number }> {
    if (tenantIds !== null && tenantIds.length === 0) {
      return { started: 0, ended: 0, failed: 0, abandoned: 0 };
    }
    const baseWhere = {
      startedAt: { gte: from, lte: to },
      ...(tenantIds ? { tenantId: { in: tenantIds } } : {}),
    };
    const [started, ended, failed, abandoned] = await this.prisma.withBypass(() =>
      Promise.all([
        this.prisma.db.session.count({ where: baseWhere }),
        this.prisma.db.session.count({ where: { ...baseWhere, status: 'ended' } }),
        this.prisma.db.session.count({ where: { ...baseWhere, status: 'failed' } }),
        this.prisma.db.session.count({ where: { ...baseWhere, status: 'abandoned' } }),
      ]),
    );
    return { started, ended, failed, abandoned };
  }
}
