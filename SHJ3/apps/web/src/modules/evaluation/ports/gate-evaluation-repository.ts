/** `GateEvaluations` — one audited decision per publish/promotion check (§4.14). */

import type { GateBlockingReason } from "./publish-gate-checker.js";
import type { GateEvaluatedForKind } from "../domain/vocabulary.js";

export interface GateEvaluationRow {
  readonly id: string;
  readonly agentVersionId: string;
  readonly evaluatedAt: Date;
  readonly passed: boolean;
  readonly gateSnapshotJson: string;
  readonly blockingReasonsJson: string | null;
  readonly evaluatedForKind: GateEvaluatedForKind;
  readonly promotionRequestId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RecordGateEvaluationInput {
  readonly agentVersionId: string;
  readonly evaluatedAt: Date;
  readonly passed: boolean;
  /** Serialised to `gateSnapshotJson` by the adapter — the exact `PublishGate` field
   *  values in force at evaluation time, so a later gate-config change never rewrites
   *  the history of a past decision. */
  readonly gateSnapshot: Record<string, unknown>;
  /** `null` when `passed`; `CK_GateEvaluations_failedHasReasons` requires exactly this
   *  pairing, so the adapter never receives a mismatched combination from a caller that
   *  ran `domain/gate-evaluation.ts` first. */
  readonly blockingReasons: readonly GateBlockingReason[] | null;
  readonly evaluatedForKind: GateEvaluatedForKind;
}

export interface GateEvaluationRepository {
  record(input: RecordGateEvaluationInput): Promise<GateEvaluationRow>;
  /** Most recent evaluation for a version, of either kind — `GetGateStatusSummary`'s own
   *  read. */
  findMostRecentForVersion(agentVersionId: string): Promise<GateEvaluationRow | null>;

  /** Across every agent version, the single most recent `passed=false` evaluation of
   *  kind `"Publish"` — B13 tab 3's live consequence strip names WHICHEVER real agent
   *  version is currently blocked most recently, matching the wireframe's own worked
   *  example ("General FAQ Agent v3.0 is currently blocked"). `null` when nothing is
   *  currently blocked (or the gate has never blocked anything yet). */
  findMostRecentlyBlockedPublish(): Promise<GateEvaluationRow | null>;
}
