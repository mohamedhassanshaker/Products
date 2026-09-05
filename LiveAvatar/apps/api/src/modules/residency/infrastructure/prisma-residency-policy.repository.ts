import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { ResidencyPolicyRecord, ResidencyPolicyRepositoryPort } from '../domain/ports';

type Row = {
  tenantId: string;
  sendToRemoteLlm: ResidencyPolicyRecord['sendToRemoteLlm'];
  retainTranscriptsDays: number;
  recordingsEnabled: boolean;
  updatedAt: Date;
};

/** Prisma persistence for `DataResidencyPolicy` (FR-PRIV-1), one row per tenant. */
@Injectable()
export class PrismaResidencyPolicyRepository implements ResidencyPolicyRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /** @inheritdoc */
  async findByTenantId(tenantId: string): Promise<ResidencyPolicyRecord | null> {
    const row = await this.prisma.db.dataResidencyPolicy.findUnique({ where: { tenantId } });
    return row ? this.toRecord(row) : null;
  }

  /** @inheritdoc */
  async update(
    tenantId: string,
    input: { sendToRemoteLlm: string; retainTranscriptsDays: number; recordingsEnabled: boolean },
    ifMatch: Date,
  ): Promise<ResidencyPolicyRecord | 'conflict' | 'missing'> {
    const existing = await this.prisma.db.dataResidencyPolicy.findUnique({ where: { tenantId } });
    if (!existing) {
      return 'missing';
    }
    const result = await this.prisma.db.dataResidencyPolicy.updateMany({
      where: { tenantId, updatedAt: ifMatch },
      data: {
        sendToRemoteLlm: input.sendToRemoteLlm as Row['sendToRemoteLlm'],
        retainTranscriptsDays: input.retainTranscriptsDays,
        recordingsEnabled: input.recordingsEnabled,
      },
    });
    if (result.count === 0) {
      return 'conflict';
    }
    const updated = await this.prisma.db.dataResidencyPolicy.findUnique({ where: { tenantId } });
    return updated ? this.toRecord(updated) : 'missing';
  }

  private toRecord(row: Row): ResidencyPolicyRecord {
    return {
      tenantId: row.tenantId,
      sendToRemoteLlm: row.sendToRemoteLlm,
      retainTranscriptsDays: row.retainTranscriptsDays,
      recordingsEnabled: row.recordingsEnabled,
      updatedAt: row.updatedAt,
    };
  }
}
