import type { NotificationChannelRecord, ReviewerGroupRecord } from './reviewer-group';
import type { HitlAttachmentKind, HitlGateRecord, HitlGateStatus, HitlGateType, HitlTimeoutBehavior } from './hitl-gate';
import type { HitlDecisionRecord, HitlDecisionStatus, HitlProposedActionRecord } from './hitl-decision';

export interface CreateReviewerGroupInput {
  tenantId: string;
  name: string;
  members: string[];
  notificationChannels: NotificationChannelRecord[];
}
export type UpdateReviewerGroupInput = Partial<Omit<CreateReviewerGroupInput, 'tenantId'>>;

export interface ReviewerGroupRepositoryPort {
  listByTenant(tenantId: string): Promise<ReviewerGroupRecord[]>;
  findById(tenantId: string, id: string): Promise<ReviewerGroupRecord | null>;
  findByName(tenantId: string, name: string): Promise<ReviewerGroupRecord | null>;
  create(input: CreateReviewerGroupInput): Promise<ReviewerGroupRecord>;
  update(tenantId: string, id: string, input: UpdateReviewerGroupInput): Promise<ReviewerGroupRecord | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
}

export const REVIEWER_GROUP_REPOSITORY = Symbol('REVIEWER_GROUP_REPOSITORY');

export interface CreateHitlGateInput {
  tenantId: string;
  attachmentKind: HitlAttachmentKind;
  attachmentRef: string;
  triggerCondition: Record<string, unknown>;
  gateType: HitlGateType;
  reviewerGroupId: string;
  slaSeconds: number;
  holdTreatmentText: string;
  timeoutBehavior: HitlTimeoutBehavior;
  escalateToGroupId: string | null;
  autoApproveAckText: string | null;
  notifyChannels: ('in_app' | 'email')[];
  environments: string[];
  status: HitlGateStatus;
  createdBy: string | null;
}
export type UpdateHitlGateInput = Partial<Omit<CreateHitlGateInput, 'tenantId' | 'createdBy'>>;

export interface HitlGateRepositoryPort {
  listByTenant(tenantId: string): Promise<HitlGateRecord[]>;
  findById(tenantId: string, id: string): Promise<HitlGateRecord | null>;
  /** Cross-tenant lookup by id only — used by the internal (`/internal/hitl-decisions`) surface, which has no admin-JWT tenant context. */
  findByIdAnyTenant(id: string): Promise<HitlGateRecord | null>;
  findByAttachment(tenantId: string, attachmentKind: HitlAttachmentKind, attachmentRef: string): Promise<HitlGateRecord[]>;
  create(input: CreateHitlGateInput): Promise<HitlGateRecord>;
  update(tenantId: string, id: string, input: UpdateHitlGateInput): Promise<HitlGateRecord | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
}

export const HITL_GATE_REPOSITORY = Symbol('HITL_GATE_REPOSITORY');

export interface CreateHitlDecisionInput {
  tenantId: string;
  sessionId: string;
  gateId: string;
  utteranceSeq: number;
  proposedAction: HitlProposedActionRecord;
}

export interface DecideHitlDecisionInput {
  reviewerId: string;
  decision: Extract<HitlDecisionStatus, 'approved' | 'denied' | 'edited_approved'>;
  editedArguments?: Record<string, unknown>;
  justificationNote?: string;
}

export interface HitlDecisionRepositoryPort {
  findById(tenantId: string, id: string): Promise<HitlDecisionRecord | null>;
  /** Cross-tenant lookup by id only — used by the internal poll endpoint. */
  findByIdAnyTenant(id: string): Promise<HitlDecisionRecord | null>;
  /** Reviewer-console queue — every `pending` decision whose gate belongs to this tenant. */
  listPendingByTenant(tenantId: string): Promise<HitlDecisionRecord[]>;
  create(input: CreateHitlDecisionInput): Promise<HitlDecisionRecord>;
  /** Resolves a `pending` decision exactly once — returns `null` if it was already decided (optimistic, no `ifMatch` needed since a decision is written by at most one reviewer). */
  decide(id: string, input: DecideHitlDecisionInput): Promise<HitlDecisionRecord | null>;
  /**
   * Server-side SLA sweep + caller-disconnect finalization — sets a
   * still-`pending` row to its terminal state per the gate's
   * `timeoutBehavior` (R-H2): `auto_approve`→`approved`, `auto_deny`→
   * `denied`, `escalate`→`escalated`, `defer_to_async`→`deferred`.
   * `reviewerId` stays `null` — no human decided.
   */
  finalizeTimedOut(id: string, decision: Extract<HitlDecisionStatus, 'approved' | 'denied' | 'timed_out' | 'escalated' | 'deferred'>): Promise<HitlDecisionRecord | null>;
  markOutcomeNotified(id: string): Promise<void>;
  /** Every `pending` row past its gate's SLA — used by `hitl-sla-sweep.processor.ts`. */
  listOverdue(
    now: Date,
  ): Promise<{ decision: HitlDecisionRecord; gateType: HitlGateType; timeoutBehavior: HitlTimeoutBehavior; escalateToGroupId: string | null }[]>;
}

export const HITL_DECISION_REPOSITORY = Symbol('HITL_DECISION_REPOSITORY');

/**
 * BullMQ queue name for the deferred-approval out-of-band tool execution
 * (Phase 14, BL-056; `ARCHITECTURE_NOTES.md` §6.3). Owned/registered here
 * (not `jobs/domain/queue-names.ts`) for the same reason
 * `KNOWLEDGE_INGEST_QUEUE` lives in `knowledge/domain/ports.ts` — the
 * producer (`DecideHitlDecisionUseCase`) lives in this module, and domain
 * modules never depend on `JobsModule`. `jobs/domain/queue-names.ts`
 * re-exports this constant, mirroring `KNOWLEDGE_INGEST_QUEUE`'s precedent.
 */
export const HITL_DEFERRED_FOLLOWUP_QUEUE = 'hitl-deferred-followup';

export interface HitlDeferredFollowupQueuePort {
  enqueue(input: { tenantId: string; decisionId: string }): Promise<void>;
}

export const HITL_DEFERRED_FOLLOWUP_QUEUE_PORT = Symbol('HITL_DEFERRED_FOLLOWUP_QUEUE_PORT');
