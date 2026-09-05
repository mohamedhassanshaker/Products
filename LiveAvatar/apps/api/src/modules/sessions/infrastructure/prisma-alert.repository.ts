import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AlertEventRow, AlertKind, AlertRepositoryPort } from '../domain/telemetry-ports';

/** `AlertEvent` persistence (FR-ALERT-*). */
@Injectable()
export class PrismaAlertRepository implements AlertRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /** @inheritdoc */
  async create(input: { tenantId: string; type: AlertKind; message: string }): Promise<void> {
    await this.prisma.withBypass(() =>
      this.prisma.db.alertEvent.create({
        data: { tenantId: input.tenantId, type: input.type, message: input.message },
      }),
    );
  }

  /** @inheritdoc */
  async list(input: {
    tenantId?: string;
    type?: AlertKind;
    from: Date;
    to: Date;
    page: number;
    pageSize: number;
  }): Promise<{ items: AlertEventRow[]; total: number }> {
    const where = {
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.type ? { type: input.type } : {}),
      createdAt: { gte: input.from, lte: input.to },
    };
    const [rows, total] = await this.prisma.withBypass(() =>
      Promise.all([
        this.prisma.db.alertEvent.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        this.prisma.db.alertEvent.count({ where }),
      ]),
    );
    return {
      items: rows.map((row) => ({ id: row.id, type: row.type, message: row.message, createdAt: row.createdAt })),
      total,
    };
  }
}
