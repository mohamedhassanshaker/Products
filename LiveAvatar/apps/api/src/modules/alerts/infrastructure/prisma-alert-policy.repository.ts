import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AlertPolicyRecord, AlertPolicyRepositoryPort } from '../domain/ports';

type Row = {
  tenantId: string;
  retryMaxAttempts: number;
  retryBackoffMs: number[];
  degradedModeMessage: string;
  updatedAt: Date;
};

/** Prisma persistence for `AlertPolicy` (FR-ALERT-1), one row per tenant. */
@Injectable()
export class PrismaAlertPolicyRepository implements AlertPolicyRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /** @inheritdoc */
  async findByTenantId(tenantId: string): Promise<AlertPolicyRecord | null> {
    const row = await this.prisma.db.alertPolicy.findUnique({ where: { tenantId } });
    return row ? this.toRecord(row) : null;
  }

  /** @inheritdoc */
  async update(
    tenantId: string,
    input: { retryMaxAttempts: number; retryBackoffMs: number[]; degradedModeMessage: string },
    ifMatch: Date,
  ): Promise<AlertPolicyRecord | 'conflict' | 'missing'> {
    const existing = await this.prisma.db.alertPolicy.findUnique({ where: { tenantId } });
    if (!existing) {
      return 'missing';
    }
    const result = await this.prisma.db.alertPolicy.updateMany({
      where: { tenantId, updatedAt: ifMatch },
      data: {
        retryMaxAttempts: input.retryMaxAttempts,
        retryBackoffMs: input.retryBackoffMs,
        degradedModeMessage: input.degradedModeMessage,
      },
    });
    if (result.count === 0) {
      return 'conflict';
    }
    const updated = await this.prisma.db.alertPolicy.findUnique({ where: { tenantId } });
    return updated ? this.toRecord(updated) : 'missing';
  }

  private toRecord(row: Row): AlertPolicyRecord {
    return {
      tenantId: row.tenantId,
      retryMaxAttempts: row.retryMaxAttempts,
      retryBackoffMs: row.retryBackoffMs,
      degradedModeMessage: row.degradedModeMessage,
      updatedAt: row.updatedAt,
    };
  }
}
