import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { ProviderStackSnapshot, ResidencySnapshot, SessionStatus, SummaryStatus } from '../../sessions';
import type { SessionDetailRow, SessionSearchRepositoryPort, SessionSummaryRow } from '../domain/ports';

/** Prisma row shape shared by both queries below. */
type Row = {
  id: string;
  tenantId: string;
  tenant: { slug: string };
  roomName: string;
  status: SessionStatus;
  errorCode: string | null;
  providerStack: unknown;
  residencySnapshot: unknown;
  displayName: string | null;
  startedAt: Date;
  endedAt: Date | null;
  transcriptPurged: boolean;
  recordingPresent: boolean;
  summaryStatus: SummaryStatus;
};

/**
 * Read-only session search (FR-SESS-1/2, Screen 5). Reads across every
 * tenant (`withBypass`) since operators legitimately see the whole platform;
 * tenant scoping is expressed as an explicit `IN (...)` filter built by the
 * use case, the same shared-table-read pattern `dashboard`/`gpu` reuse.
 */
@Injectable()
export class PrismaSessionSearchRepository implements SessionSearchRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /** @inheritdoc */
  async search(input: {
    tenantIds: string[] | null;
    sessionIds?: string[];
    from?: Date;
    to?: Date;
    status?: SessionStatus;
    page: number;
    pageSize: number;
  }): Promise<{ items: SessionSummaryRow[]; total: number }> {
    if (input.tenantIds !== null && input.tenantIds.length === 0) {
      return { items: [], total: 0 };
    }
    if (input.sessionIds && input.sessionIds.length === 0) {
      return { items: [], total: 0 };
    }

    const where: Record<string, unknown> = {};
    if (input.tenantIds) {
      where.tenantId = { in: input.tenantIds };
    }
    if (input.sessionIds) {
      where.id = { in: input.sessionIds };
    }
    if (input.status) {
      where.status = input.status;
    }
    if (input.from || input.to) {
      where.startedAt = {
        ...(input.from ? { gte: input.from } : {}),
        ...(input.to ? { lte: input.to } : {}),
      };
    }

    const [rows, total] = await this.prisma.withBypass(() =>
      Promise.all([
        this.prisma.db.session.findMany({
          where,
          include: { tenant: { select: { slug: true } } },
          orderBy: { startedAt: 'desc' },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        this.prisma.db.session.count({ where }),
      ]),
    );
    return { items: rows.map((row: Row) => this.toSummaryRow(row)), total };
  }

  /** @inheritdoc */
  async findDetail(id: string): Promise<SessionDetailRow | null> {
    const row = await this.prisma.withBypass(() =>
      this.prisma.db.session.findUnique({
        where: { id },
        include: { tenant: { select: { slug: true } } },
      }),
    );
    if (!row) {
      return null;
    }
    return {
      ...this.toSummaryRow(row),
      roomName: row.roomName,
      residencySnapshot: row.residencySnapshot as unknown as ResidencySnapshot,
      recordingPresent: row.recordingPresent,
      summaryStatus: row.summaryStatus,
      displayName: row.displayName,
    };
  }

  private toSummaryRow(row: Row): SessionSummaryRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      tenantSlug: row.tenant.slug,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      status: row.status,
      providerStack: row.providerStack as ProviderStackSnapshot,
      errorCode: row.errorCode,
      transcriptPurged: row.transcriptPurged,
    };
  }
}
