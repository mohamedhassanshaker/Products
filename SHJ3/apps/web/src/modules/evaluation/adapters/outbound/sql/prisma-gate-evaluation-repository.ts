import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type { GateEvaluatedForKind } from "../../../domain/vocabulary.js";
import type {
  GateEvaluationRepository,
  GateEvaluationRow,
  RecordGateEvaluationInput,
} from "../../../ports/gate-evaluation-repository.js";

function toRow(row: {
  id: string;
  agentVersionId: string;
  evaluatedAt: Date;
  passed: boolean;
  gateSnapshotJson: string;
  blockingReasonsJson: string | null;
  evaluatedForKind: string;
  promotionRequestId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): GateEvaluationRow {
  return {
    id: row.id,
    agentVersionId: row.agentVersionId,
    evaluatedAt: row.evaluatedAt,
    passed: row.passed,
    gateSnapshotJson: row.gateSnapshotJson,
    blockingReasonsJson: row.blockingReasonsJson,
    evaluatedForKind: row.evaluatedForKind as GateEvaluatedForKind,
    promotionRequestId: row.promotionRequestId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaGateEvaluationRepository implements GateEvaluationRepository {
  async record(input: RecordGateEvaluationInput): Promise<GateEvaluationRow> {
    const row = await getTenantDb("evaluation gate evaluation record").gateEvaluation.create({
      data: {
        id: newUlid(),
        agentVersionId: input.agentVersionId,
        evaluatedAt: input.evaluatedAt,
        passed: input.passed,
        // `CK_GateEvaluations_failedHasReasons` — the caller (`evaluate-gate-for-
        // version.ts`) has already run `domain/gate-evaluation.ts`, which guarantees this
        // pairing before it ever reaches here; this adapter only serialises it.
        gateSnapshotJson: JSON.stringify(input.gateSnapshot),
        blockingReasonsJson:
          input.blockingReasons === null ? null : JSON.stringify(input.blockingReasons),
        evaluatedForKind: input.evaluatedForKind,
        promotionRequestId: null,
        createdAt: input.evaluatedAt,
        updatedAt: input.evaluatedAt,
      },
    });
    return toRow(row);
  }

  async findMostRecentForVersion(agentVersionId: string): Promise<GateEvaluationRow | null> {
    const row = await getTenantDb("evaluation gate evaluation latest").gateEvaluation.findFirst({
      where: { agentVersionId },
      orderBy: { evaluatedAt: "desc" },
    });
    return row ? toRow(row) : null;
  }

  async findMostRecentlyBlockedPublish(): Promise<GateEvaluationRow | null> {
    const row = await getTenantDb(
      "evaluation gate evaluation most recently blocked",
    ).gateEvaluation.findFirst({
      where: { passed: false, evaluatedForKind: "Publish" },
      orderBy: { evaluatedAt: "desc" },
    });
    return row ? toRow(row) : null;
  }
}
