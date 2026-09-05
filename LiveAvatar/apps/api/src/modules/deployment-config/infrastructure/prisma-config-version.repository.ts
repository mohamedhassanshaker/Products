import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { ConfigVersionRecord, ConfigVersionRepositoryPort } from '../domain/ports';

type Row = {
  id: string;
  tenantId: string;
  versionNumber: number;
  yamlText: string;
  status: 'published' | 'superseded' | 'rolled_back';
  publishedAt: Date;
  createdBy: string | null;
  createdAt: Date;
  rolledBackFrom: string | null;
};

/**
 * `ConfigVersion` read/rollback-support persistence (Phase 9, BL-035). The
 * append-only insert-on-publish path lives in
 * `PrismaDeploymentConfigRepository.save` (same transaction as the
 * `DeploymentConfig` update) — this repository only ever reads, or marks a
 * row `rolled_back` (never inserts/updates `yamlText`, preserving
 * append-only-ness).
 */
@Injectable()
export class PrismaConfigVersionRepository implements ConfigVersionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async listByTenantId(tenantId: string): Promise<ConfigVersionRecord[]> {
    const rows = await this.prisma.db.configVersion.findMany({
      where: { tenantId },
      orderBy: { versionNumber: 'desc' },
    });
    return rows.map((row: Row) => this.toRecord(row));
  }

  async findByTenantAndVersion(tenantId: string, versionNumber: number): Promise<ConfigVersionRecord | null> {
    const row = await this.prisma.db.configVersion.findFirst({ where: { tenantId, versionNumber } });
    return row ? this.toRecord(row) : null;
  }

  async markRolledBack(tenantId: string, versionNumber: number): Promise<void> {
    await this.prisma.db.configVersion.updateMany({
      where: { tenantId, versionNumber },
      data: { status: 'rolled_back' },
    });
  }

  private toRecord(row: Row): ConfigVersionRecord {
    return {
      id: row.id,
      tenantId: row.tenantId,
      versionNumber: row.versionNumber,
      yamlText: row.yamlText,
      status: row.status,
      publishedAt: row.publishedAt,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      rolledBackFrom: row.rolledBackFrom,
    };
  }
}
