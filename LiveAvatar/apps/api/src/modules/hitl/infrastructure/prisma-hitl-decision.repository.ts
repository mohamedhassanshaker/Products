import { Injectable } from '@nestjs/common';
import type { PrismaJsonInput } from '../../../common/prisma/json';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { HitlDecisionRecord, HitlDecisionStatus, HitlProposedActionRecord } from '../domain/hitl-decision';
import type { HitlGateType, HitlTimeoutBehavior } from '../domain/hitl-gate';
import type { CreateHitlDecisionInput, DecideHitlDecisionInput, HitlDecisionRepositoryPort } from '../domain/ports';

type Row = {
  id: string;
  tenantId: string;
  sessionId: string;
  gateId: string;
  utteranceSeq: number;
  proposedAction: unknown;
  reviewerId: string | null;
  decision: string;
  editedArguments: unknown;
  justificationNote: string | null;
  decidedAt: Date | null;
  latencyMs: number | null;
  outcomeNotifiedAt: Date | null;
  createdAt: Date;
};

/**
 * `HitlDecision` persistence (Phase 14, BL-052/053) — simultaneously the
 * R-H7 audit trail, the live reviewer queue, and the R-H10 metrics source
 * (see the domain type's own doc comment). `decide`/`finalizeTimedOut` use
 * an atomic `updateMany({ where: { id, decision: 'pending' } })` guard so a
 * decision is resolved exactly once even if two callers race (the
 * server-side SLA sweep and a reviewer's click landing at the same moment).
 */
@Injectable()
export class PrismaHitlDecisionRepository implements HitlDecisionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, id: string): Promise<HitlDecisionRecord | null> {
    const row = await this.prisma.db.hitlDecision.findFirst({ where: { id, tenantId } });
    return row ? this.toRecord(row) : null;
  }

  async findByIdAnyTenant(id: string): Promise<HitlDecisionRecord | null> {
    const row = await this.prisma.db.hitlDecision.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async listPendingByTenant(tenantId: string): Promise<HitlDecisionRecord[]> {
    const rows = await this.prisma.db.hitlDecision.findMany({
      where: { tenantId, decision: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row: Row) => this.toRecord(row));
  }

  async create(input: CreateHitlDecisionInput): Promise<HitlDecisionRecord> {
    const row = await this.prisma.db.hitlDecision.create({
      data: {
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        gateId: input.gateId,
        utteranceSeq: input.utteranceSeq,
        proposedAction: this.proposedActionToJson(input.proposedAction),
      },
    });
    return this.toRecord(row);
  }

  async decide(id: string, input: DecideHitlDecisionInput): Promise<HitlDecisionRecord | null> {
    const existing = await this.prisma.db.hitlDecision.findUnique({ where: { id } });
    if (!existing || existing.decision !== 'pending') {
      return null;
    }
    const now = new Date();
    const result = await this.prisma.db.hitlDecision.updateMany({
      where: { id, decision: 'pending' },
      data: {
        reviewerId: input.reviewerId,
        decision: input.decision,
        editedArguments: input.editedArguments !== undefined ? (input.editedArguments as PrismaJsonInput) : undefined,
        justificationNote: input.justificationNote,
        decidedAt: now,
        latencyMs: now.getTime() - existing.createdAt.getTime(),
      },
    });
    if (result.count === 0) {
      return null;
    }
    const updated = await this.prisma.db.hitlDecision.findUnique({ where: { id } });
    return updated ? this.toRecord(updated) : null;
  }

  async finalizeTimedOut(
    id: string,
    decision: Extract<HitlDecisionStatus, 'approved' | 'denied' | 'timed_out' | 'escalated' | 'deferred'>,
  ): Promise<HitlDecisionRecord | null> {
    const existing = await this.prisma.db.hitlDecision.findUnique({ where: { id } });
    if (!existing || existing.decision !== 'pending') {
      return null;
    }
    const now = new Date();
    const result = await this.prisma.db.hitlDecision.updateMany({
      where: { id, decision: 'pending' },
      data: { decision, decidedAt: now, latencyMs: now.getTime() - existing.createdAt.getTime() },
    });
    if (result.count === 0) {
      return null;
    }
    const updated = await this.prisma.db.hitlDecision.findUnique({ where: { id } });
    return updated ? this.toRecord(updated) : null;
  }

  async markOutcomeNotified(id: string): Promise<void> {
    await this.prisma.db.hitlDecision.updateMany({ where: { id }, data: { outcomeNotifiedAt: new Date() } });
  }

  async listOverdue(
    now: Date,
  ): Promise<{ decision: HitlDecisionRecord; gateType: HitlGateType; timeoutBehavior: HitlTimeoutBehavior; escalateToGroupId: string | null }[]> {
    // Pending queues are small by construction (a live gate hit resolves
    // within its own SLA, typically seconds to low minutes) — filtering the
    // SLA arithmetic in application code rather than raw SQL keeps this
    // repository ORM-only, consistent with every other repository here.
    const rows = await this.prisma.db.hitlDecision.findMany({
      where: { decision: 'pending' },
      include: { gate: true },
    });
    const overdue: { decision: HitlDecisionRecord; gateType: HitlGateType; timeoutBehavior: HitlTimeoutBehavior; escalateToGroupId: string | null }[] = [];
    for (const row of rows) {
      const deadline = row.createdAt.getTime() + row.gate.slaSeconds * 1000;
      if (deadline <= now.getTime()) {
        overdue.push({
          decision: this.toRecord(row),
          gateType: row.gate.gateType as HitlGateType,
          timeoutBehavior: row.gate.timeoutBehavior as HitlTimeoutBehavior,
          escalateToGroupId: row.gate.escalateToGroupId,
        });
      }
    }
    return overdue;
  }

  private proposedActionToJson(action: HitlProposedActionRecord): PrismaJsonInput {
    return {
      kind: action.kind,
      summary: action.summary,
      arguments: action.arguments ?? null,
      transcript_excerpt: action.transcriptExcerpt ?? null,
      caller_identity: action.callerIdentity ?? null,
      retrieved_sources: action.retrievedSources ?? null,
      model_reasoning: action.modelReasoning ?? null,
    } as unknown as PrismaJsonInput;
  }

  private toRecord(row: Row): HitlDecisionRecord {
    const action = (row.proposedAction ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      tenantId: row.tenantId,
      sessionId: row.sessionId,
      gateId: row.gateId,
      utteranceSeq: row.utteranceSeq,
      proposedAction: {
        kind: action.kind as HitlProposedActionRecord['kind'],
        summary: (action.summary as string) ?? '',
        arguments: (action.arguments as Record<string, unknown>) ?? undefined,
        transcriptExcerpt: (action.transcript_excerpt as string[]) ?? undefined,
        callerIdentity: (action.caller_identity as string) ?? undefined,
        retrievedSources: (action.retrieved_sources as string[]) ?? undefined,
        modelReasoning: (action.model_reasoning as string) ?? undefined,
      },
      reviewerId: row.reviewerId,
      decision: row.decision as HitlDecisionStatus,
      editedArguments: (row.editedArguments ?? null) as Record<string, unknown> | null,
      justificationNote: row.justificationNote,
      decidedAt: row.decidedAt,
      latencyMs: row.latencyMs,
      outcomeNotifiedAt: row.outcomeNotifiedAt,
      createdAt: row.createdAt,
    };
  }
}
