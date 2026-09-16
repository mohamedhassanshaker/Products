import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { versionLabel, type PromotionStatus } from "../../../domain/promotion.js";
import type {
  DecidePromotionInput,
  NewPromotionRequestInput,
  PromotionRequestRepository,
  PromotionRequestRow,
} from "../../../ports/promotion-repository.js";

const OPERATION = "governance promotion request";

/**
 * `PromotionRequests` — real Prisma relations exist here (unlike `Environment`, which is
 * platform-schema). `create`/`decide` are plain `create`/`update` calls: the real
 * atomicity guarantee is `TR_PromotionRequests_decisionRules`
 * (`prisma/sql/001_constraints.sql`), which validates the chain/gate/self-approval rules
 * and writes `AuditLogEntries` in the SAME transaction as this exact statement. This
 * adapter's job is narrower — call the write correctly and let the trigger's real thrown
 * errors (matched by `domain/promotion.ts#mapPromotionTriggerError` in the application
 * layer) surface rather than being swallowed.
 */
export class PrismaPromotionRequestRepository implements PromotionRequestRepository {
  async findById(id: string): Promise<PromotionRequestRow | null> {
    const row = await getTenantDb(OPERATION).promotionRequest.findUnique({
      where: { id },
      include: { agentVersion: { include: { agent: { select: { id: true, name: true } } } } },
    });
    if (!row) return null;
    return toRow(row);
  }

  async listPending(): Promise<readonly PromotionRequestRow[]> {
    const rows = await getTenantDb(OPERATION).promotionRequest.findMany({
      where: { status: "AwaitingApproval" },
      include: { agentVersion: { include: { agent: { select: { id: true, name: true } } } } },
      orderBy: { requestedAt: "asc" },
    });
    return rows.map(toRow);
  }

  async findVersionSummary(agentVersionId: string): Promise<{
    readonly agentId: string;
    readonly agentName: string;
    readonly versionLabel: string;
  } | null> {
    const row = await getTenantDb(OPERATION).agentVersion.findUnique({
      where: { id: agentVersionId },
      include: { agent: { select: { id: true, name: true } } },
    });
    if (!row) return null;
    return {
      agentId: row.agent.id,
      agentName: row.agent.name,
      versionLabel: versionLabel(row.major, row.minor),
    };
  }

  async create(input: NewPromotionRequestInput): Promise<{ readonly id: string }> {
    const created = await getTenantDb(OPERATION).promotionRequest.create({
      data: {
        id: newId(),
        agentVersionId: input.agentVersionId,
        fromEnvironmentKey: input.fromEnvironmentKey,
        toEnvironmentKey: input.toEnvironmentKey,
        requestedByStaffUserId: input.requestedByStaffUserId,
        requestedAt: input.now,
        status: "AwaitingApproval",
        gateEvaluationId: input.gateEvaluationId,
        createdAt: input.now,
        updatedAt: input.now,
      },
      select: { id: true },
    });
    return created;
  }

  /**
   * `TR_PromotionRequests_decisionRules` fires on this exact `UPDATE` and, in the SAME
   * transaction: validates separation of duties (error 51192 otherwise), and writes the
   * matching `AuditLogEntries` row (`action = 'promotion.decided'`). If this call throws,
   * SQL Server has already rolled back the whole statement — no partial status change, no
   * stray audit row. If it resolves, both are committed together. This is the real
   * atomicity guarantee this codebase asked to be proven live (see the module's own
   * verification script).
   */
  async decide(id: string, input: DecidePromotionInput): Promise<void> {
    await getTenantDb(OPERATION).promotionRequest.update({
      where: { id },
      data: {
        status: input.status,
        decidedByStaffUserId: input.decidedByStaffUserId,
        decidedAt: input.now,
        decisionNote: input.decisionNote,
        updatedAt: input.now,
      },
    });
  }
}

function newId(): string {
  return newUlid();
}

type PromotionRequestPrismaRow = {
  id: string;
  agentVersionId: string;
  fromEnvironmentKey: string;
  toEnvironmentKey: string;
  requestedByStaffUserId: string;
  requestedAt: Date;
  status: string;
  gateEvaluationId: string | null;
  decidedByStaffUserId: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  agentVersion: { major: number; minor: number; agent: { id: string; name: string } };
};

function toRow(row: PromotionRequestPrismaRow): PromotionRequestRow {
  return {
    id: row.id,
    agentVersionId: row.agentVersionId,
    agentId: row.agentVersion.agent.id,
    agentName: row.agentVersion.agent.name,
    versionLabel: versionLabel(row.agentVersion.major, row.agentVersion.minor),
    fromEnvironmentKey: row.fromEnvironmentKey,
    toEnvironmentKey: row.toEnvironmentKey,
    requestedByStaffUserId: row.requestedByStaffUserId,
    requestedAt: row.requestedAt,
    status: row.status as PromotionStatus,
    gateEvaluationId: row.gateEvaluationId,
    decidedByStaffUserId: row.decidedByStaffUserId,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
  };
}
