import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { ProviderStackSnapshot, ResidencySnapshot, SessionRecord, SessionStatus } from '../domain/session';
import type { SessionRepositoryPort } from '../domain/ports';

/** Prisma row shape for a `Session`, before mapping to `SessionRecord`. */
type SessionRow = {
  id: string;
  tenantId: string;
  roomName: string;
  status: SessionStatus;
  errorCode: string | null;
  providerStack: unknown;
  residencySnapshot: unknown;
  displayName: string | null;
  tabKey: string | null;
  maxDurationSeconds: number;
  startedAt: Date;
  joinedAt: Date | null;
  endedAt: Date | null;
  summaryTokenHash: string | null;
  summaryTokenExpiresAt: Date | null;
  summaryText: string | null;
  summaryStatus: SessionRecord['summaryStatus'];
  transcriptPurged: boolean;
  recordingPresent: boolean;
};

/**
 * Prisma persistence for `Session` (FR-TRANSPORT-4). Public/internal callers
 * frequently only know a session or room name, not its tenant, so lookups
 * here intentionally use `withBypass` — the same escape hatch
 * `IdempotencyInterceptor` and the Phase-1 tenant-create side effects already
 * rely on — rather than depending on `TenantContextInterceptor`'s ALS value,
 * which is meaningless on `/public/*`/`/internal/*` routes (no `:tenantId`
 * path param to bind). Every write still carries an explicit `tenantId` so
 * the tenantGuard extension never has to fall back to ALS either way.
 */
@Injectable()
export class PrismaSessionRepository implements SessionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /** @inheritdoc */
  async create(input: {
    id: string;
    tenantId: string;
    roomName: string;
    providerStack: ProviderStackSnapshot;
    residencySnapshot: ResidencySnapshot;
    displayName: string;
    tabKey: string | null;
    maxDurationSeconds: number;
  }): Promise<SessionRecord> {
    const row = await this.prisma.withBypass(() =>
      this.prisma.db.session.create({
        data: {
          id: input.id,
          tenantId: input.tenantId,
          roomName: input.roomName,
          providerStack: input.providerStack as object,
          residencySnapshot: input.residencySnapshot as object,
          displayName: input.displayName,
          tabKey: input.tabKey,
          maxDurationSeconds: input.maxDurationSeconds,
        },
      }),
    );
    return this.toRecord(row);
  }

  /** @inheritdoc */
  async findById(id: string): Promise<SessionRecord | null> {
    const row = await this.prisma.withBypass(() => this.prisma.db.session.findUnique({ where: { id } }));
    return row ? this.toRecord(row) : null;
  }

  /** @inheritdoc */
  async findByRoomName(roomName: string): Promise<SessionRecord | null> {
    const row = await this.prisma.withBypass(() => this.prisma.db.session.findUnique({ where: { roomName } }));
    return row ? this.toRecord(row) : null;
  }

  /** @inheritdoc */
  async findPendingByTabKey(tenantId: string, tabKey: string): Promise<SessionRecord | null> {
    const row = await this.prisma.withBypass(() =>
      this.prisma.db.session.findFirst({
        where: { tenantId, tabKey, status: 'pending' },
        orderBy: { startedAt: 'desc' },
      }),
    );
    return row ? this.toRecord(row) : null;
  }

  /** @inheritdoc */
  async applyStatus(
    id: string,
    patch: { status: SessionStatus; joinedAt?: Date; endedAt?: Date; errorCode?: string | null },
  ): Promise<SessionRecord | null> {
    try {
      const row = await this.prisma.withBypass(() =>
        this.prisma.db.session.update({
          where: { id },
          data: {
            status: patch.status,
            ...(patch.joinedAt !== undefined ? { joinedAt: patch.joinedAt } : {}),
            ...(patch.endedAt !== undefined ? { endedAt: patch.endedAt } : {}),
            ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
          },
        }),
      );
      return this.toRecord(row);
    } catch {
      return null;
    }
  }

  /** @inheritdoc */
  async setSummaryToken(id: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.prisma.withBypass(() =>
      this.prisma.db.session.update({
        where: { id },
        data: { summaryTokenHash: tokenHash, summaryTokenExpiresAt: expiresAt },
      }),
    );
  }

  /** @inheritdoc */
  async setSummary(id: string, status: 'ready' | 'unavailable', text: string | null): Promise<void> {
    await this.prisma.withBypass(() =>
      this.prisma.db.session.update({
        where: { id },
        data: { summaryStatus: status, summaryText: text },
      }),
    );
  }

  /** @inheritdoc */
  async listAbandonable(olderThan: Date): Promise<SessionRecord[]> {
    const rows = await this.prisma.withBypass(() =>
      this.prisma.db.session.findMany({
        where: { status: 'pending', startedAt: { lt: olderThan } },
      }),
    );
    return rows.map((row: SessionRow) => this.toRecord(row));
  }

  /** @inheritdoc */
  async listActiveJoined(): Promise<SessionRecord[]> {
    const rows = await this.prisma.withBypass(() =>
      this.prisma.db.session.findMany({
        where: { status: 'active', joinedAt: { not: null } },
      }),
    );
    return rows.map((row: SessionRow) => this.toRecord(row));
  }

  private toRecord(row: SessionRow): SessionRecord {
    return {
      id: row.id,
      tenantId: row.tenantId,
      roomName: row.roomName,
      status: row.status,
      errorCode: row.errorCode,
      providerStack: row.providerStack as ProviderStackSnapshot,
      residencySnapshot: row.residencySnapshot as ResidencySnapshot,
      displayName: row.displayName,
      tabKey: row.tabKey,
      maxDurationSeconds: row.maxDurationSeconds,
      startedAt: row.startedAt,
      joinedAt: row.joinedAt,
      endedAt: row.endedAt,
      summaryTokenHash: row.summaryTokenHash,
      summaryTokenExpiresAt: row.summaryTokenExpiresAt,
      summaryText: row.summaryText,
      summaryStatus: row.summaryStatus,
      transcriptPurged: row.transcriptPurged,
      recordingPresent: row.recordingPresent,
    };
  }
}
