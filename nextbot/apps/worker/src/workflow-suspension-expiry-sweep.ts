import { createOrchestrationNodeRuntime, sweepWorkflowSuspensionExpiry } from "@nextbot/workflows";
import { createMcpEgressPort } from "@nextbot/tool-registry";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, FR-WF-05, LLD §14.6.2's corrected job
 * table) — transitions any `state='Suspended' AND suspension_expires_at < now()` run to
 * its DECLARED `suspension_expiry_outcome` ("a run never remains suspended
 * indefinitely"). Modelled on `escalation.sla-sweep`, the real shipped due-date sweep in
 * this repo — not the `a2a.input-required-sweep` the superseded LLD text named, which
 * has never existed.
 *
 * For `suspension_kind = 'Approval'` it first expires the underlying Tier-2/Tier-3 call
 * through `@nextbot/orchestration`'s SHARED expiry primitive (ADR-0013 §7.4), so the
 * Approval Queue can never show an actionable request for a run this sweep is about to
 * terminate. 60s tick.
 */
export async function runWorkflowSuspensionExpirySweep(): Promise<ReturnType<typeof sweepWorkflowSuspensionExpiry>> {
  return sweepWorkflowSuspensionExpiry((ctx) => createOrchestrationNodeRuntime(ctx, { egress: createMcpEgressPort(ctx) }));
}
