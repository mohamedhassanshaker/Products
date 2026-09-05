import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { GpuNodeRepositoryPort, GpuNodeRow, GpuRole } from '../domain/ports';

type Row = {
  hostname: string;
  role: GpuRole;
  gpuUtilPct: unknown;
  memUtilPct: unknown;
  healthy: boolean;
  autoscalerNote: string;
  reportedAt: Date;
};

/**
 * `GpuNodeHeartbeat` persistence (FR-GPU-1/3). `GpuNodeHeartbeat` is not in
 * the tenantGuard's scoped model set (LLD §4.1 — `tenantId` is nullable,
 * "shared pool"), so no `withBypass` is needed for either write or read here.
 */
@Injectable()
export class PrismaGpuNodeRepository implements GpuNodeRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /** @inheritdoc */
  async recordHeartbeat(input: {
    hostname: string;
    role: GpuRole;
    gpuUtilPct: number;
    memUtilPct: number;
    healthy: boolean;
    tenantId: string | null;
    reportedAt: Date;
  }): Promise<void> {
    await this.prisma.db.gpuNodeHeartbeat.create({
      data: {
        hostname: input.hostname,
        role: input.role,
        gpuUtilPct: input.gpuUtilPct,
        memUtilPct: input.memUtilPct,
        healthy: input.healthy,
        tenantId: input.tenantId,
        reportedAt: input.reportedAt,
      },
    });
  }

  /** @inheritdoc */
  async listLatestPerHost(filter: { role?: GpuRole; tenantId?: string }): Promise<GpuNodeRow[]> {
    const rows = await this.prisma.db.gpuNodeHeartbeat.findMany({
      where: {
        ...(filter.role ? { role: filter.role } : {}),
        ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      },
      orderBy: [{ hostname: 'asc' }, { reportedAt: 'desc' }],
      distinct: ['hostname'],
    });
    return rows.map((row: Row) => ({
      hostname: row.hostname,
      role: row.role,
      gpuUtilPct: Number(row.gpuUtilPct),
      memUtilPct: Number(row.memUtilPct),
      healthy: row.healthy,
      autoscalerNote: row.autoscalerNote,
      reportedAt: row.reportedAt,
    }));
  }
}
