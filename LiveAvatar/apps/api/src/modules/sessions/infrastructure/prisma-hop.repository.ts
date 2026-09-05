import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { HopInput, HopRepositoryPort, HopRow } from '../domain/telemetry-ports';

/**
 * `LatencyHop` persistence (NFR-1). Each item is upserted on the
 * `(session_id, utterance_seq, hop, node_id)` unique index (widened Phase 9,
 * BL-039 — see `LatencyHop.nodeId`'s schema comment) so a retried batch
 * never double-counts a hop, and multiple `hop="node"` rows can coexist per
 * utterance (one per graph-node execution). `nodeId` always defaults to
 * `''` for the pre-Phase-9 hop kinds, preserving their exact retry
 * idempotency.
 */
@Injectable()
export class PrismaHopRepository implements HopRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /** @inheritdoc */
  async upsertMany(sessionId: string, tenantId: string, items: HopInput[]): Promise<void> {
    await this.prisma.withBypass(() =>
      Promise.all(
        items.map((item) => {
          const nodeId = item.nodeId ?? '';
          return this.prisma.db.latencyHop.upsert({
            where: { sessionId_utteranceSeq_hop_nodeId: { sessionId, utteranceSeq: item.utteranceSeq, hop: item.hop, nodeId } },
            create: {
              sessionId,
              tenantId,
              utteranceSeq: item.utteranceSeq,
              hop: item.hop,
              firstPartialMs: item.firstPartialMs,
              firstTokenMs: item.firstTokenMs,
              firstAudioMs: item.firstAudioMs,
              firstFrameMs: item.firstFrameMs,
              totalMs: item.totalMs,
              providerKey: item.providerKey,
              usedFallback: item.usedFallback ?? false,
              errorCode: item.errorCode,
              nodeId,
              nodeType: item.nodeType,
              lane: item.lane,
            },
            update: {
              firstPartialMs: item.firstPartialMs,
              firstTokenMs: item.firstTokenMs,
              firstAudioMs: item.firstAudioMs,
              firstFrameMs: item.firstFrameMs,
              totalMs: item.totalMs,
              providerKey: item.providerKey,
              usedFallback: item.usedFallback ?? false,
              errorCode: item.errorCode,
              nodeType: item.nodeType,
              lane: item.lane,
            },
          });
        }),
      ),
    );
  }

  /** @inheritdoc */
  async listBySession(sessionId: string): Promise<HopRow[]> {
    const rows = await this.prisma.withBypass(() =>
      this.prisma.db.latencyHop.findMany({
        where: { sessionId },
        orderBy: [{ utteranceSeq: 'asc' }, { createdAt: 'asc' }],
      }),
    );
    return rows.map((row) => ({
      utteranceSeq: row.utteranceSeq,
      hop: row.hop,
      firstPartialMs: row.firstPartialMs,
      firstTokenMs: row.firstTokenMs,
      firstAudioMs: row.firstAudioMs,
      firstFrameMs: row.firstFrameMs,
      totalMs: row.totalMs,
      providerKey: row.providerKey,
      usedFallback: row.usedFallback,
      errorCode: row.errorCode,
      nodeId: row.nodeId,
      nodeType: row.nodeType,
      lane: row.lane,
    }));
  }

  /** @inheritdoc */
  async countLlmFailoverStats(
    tenantId: string,
    since: Date,
  ): Promise<{ primaryFailures: number; fallbackSuccesses: number; degradedInvocations: number }> {
    const [fallbackSuccesses, degradedInvocations] = await this.prisma.withBypass(() =>
      Promise.all([
        this.prisma.db.latencyHop.count({
          where: { tenantId, hop: 'llm', usedFallback: true, errorCode: null, createdAt: { gte: since } },
        }),
        this.prisma.db.latencyHop.count({
          where: { tenantId, hop: 'llm', errorCode: { not: null }, createdAt: { gte: since } },
        }),
      ]),
    );
    // Every primary-LLM failure that triggers the failover ladder (LLD §8.4)
    // ends in exactly one of these two recorded outcomes — a successful
    // fallback or a full exhaustion — so their sum is the count of primary
    // failures that actually mattered (FR-ALERT-2).
    return { primaryFailures: fallbackSuccesses + degradedInvocations, fallbackSuccesses, degradedInvocations };
  }
}
