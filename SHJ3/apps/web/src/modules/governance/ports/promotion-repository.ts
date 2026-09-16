import type { PromotionStatus } from "../domain/promotion.js";

/** A `PromotionRequests` row joined (application-side, same tenant client — a real
 *  Prisma `@relation` exists here, unlike the platform/tenant split) with its
 *  `AgentVersion`/`Agent` for display. */
export interface PromotionRequestRow {
  readonly id: string;
  readonly agentVersionId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly versionLabel: string;
  readonly fromEnvironmentKey: string;
  readonly toEnvironmentKey: string;
  readonly requestedByStaffUserId: string;
  readonly requestedAt: Date;
  readonly status: PromotionStatus;
  readonly gateEvaluationId: string | null;
  readonly decidedByStaffUserId: string | null;
  readonly decidedAt: Date | null;
  readonly decisionNote: string | null;
}

export interface NewPromotionRequestInput {
  readonly agentVersionId: string;
  readonly fromEnvironmentKey: string;
  readonly toEnvironmentKey: string;
  readonly requestedByStaffUserId: string;
  readonly gateEvaluationId: string | null;
  readonly now: Date;
}

export interface DecidePromotionInput {
  readonly decidedByStaffUserId: string;
  readonly status: "Approved" | "Rejected";
  readonly decisionNote: string | null;
  readonly now: Date;
}

export interface PromotionRequestRepository {
  findById(id: string): Promise<PromotionRequestRow | null>;
  /** Every row with `status = 'AwaitingApproval'` — B14 tab 1's pending list. */
  listPending(): Promise<readonly PromotionRequestRow[]>;

  /** `AgentVersions.agentId`/`major`/`minor`/`Agents.name` for the composed row above —
   *  looked up once so `RequestPromotion` can validate `agentId` matches the caller's
   *  intent and compose the audit `targetLabelSnapshot` without a second round trip. */
  findVersionSummary(agentVersionId: string): Promise<{
    readonly agentId: string;
    readonly agentName: string;
    readonly versionLabel: string;
  } | null>;

  /** Raises the real DB trigger's errors (51190/51191/51192) as thrown Prisma errors on
   *  failure — the caller (`RequestPromotion`) maps them via
   *  `domain/promotion.ts#mapPromotionTriggerError`. Returns the new row's id. */
  create(input: NewPromotionRequestInput): Promise<{ readonly id: string }>;

  /**
   * Updates `status`/`decidedByStaffUserId`/`decidedAt`/`decisionNote`. The SAME trigger
   * that validated the insert also writes `AuditLogEntries` in this same transaction on
   * this exact write (`TR_PromotionRequests_decisionRules`) — this method's own success
   * or failure IS the atomicity: either both the status change and the audit row commit,
   * or (a thrown error) neither does. Never wrap this in an application-level
   * `$transaction` — the trigger already is the transaction boundary.
   */
  decide(id: string, input: DecidePromotionInput): Promise<void>;
}
