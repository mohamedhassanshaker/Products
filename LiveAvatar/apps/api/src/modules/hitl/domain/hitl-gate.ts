export type HitlAttachmentKind = 'tool' | 'skill' | 'graph_node';
export type HitlGateType = 'blocking' | 'deferred' | 'pre_speech' | 'whisper' | 'post_hoc';
export type HitlTimeoutBehavior = 'auto_approve' | 'auto_deny' | 'escalate' | 'defer_to_async';
export type HitlGateStatus = 'active' | 'disabled';

/** v1 (`docs/v2/UX_SCOPE.md`) only ever creates these three — `whisper`/`post_hoc` are rejected by `assertSupportedGateType`. */
export const SUPPORTED_HITL_GATE_TYPES: readonly HitlGateType[] = ['blocking', 'deferred', 'pre_speech'];

/**
 * `HitlGate` aggregate (Phase 14, BL-052/053/054; `ARCHITECTURE_NOTES.md`
 * §6.1). R-H1's six mandatory fields (`triggerCondition`, `gateType`,
 * `reviewerGroupId`, `slaSeconds`, `holdTreatmentText`, `timeoutBehavior`)
 * are all non-optional here — unlike `Skill`/`SkillVersion`'s draft/
 * published split, a gate has no partially-specified saved state at all
 * (see `hitl-validation.ts`).
 */
export interface HitlGateRecord {
  id: string;
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
  /** V-8's "written acknowledgement" — required by the application layer only when `timeoutBehavior === 'auto_approve'` on a consequential-tool attachment. */
  autoApproveAckText: string | null;
  notifyChannels: ('in_app' | 'email')[];
  environments: string[];
  status: HitlGateStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}
