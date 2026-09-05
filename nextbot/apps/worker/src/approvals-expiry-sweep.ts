import { sweepExpiredApprovals } from "@nextbot/orchestration";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, ADR-0013 §7.4, LLD §14.6.2's
 * corrected job table) — expires past-due Tier-2 (`AwaitingCustomerConfirmation`,
 * LLD §6.4's 900s default) and Tier-3 (`AwaitingHumanApproval`, LLD §6.5's 24h
 * default) tool calls to the already-defined terminal `Expired` state.
 *
 * Closes a gap `packages/modules/orchestration`'s own `approval-service.ts` has
 * disclosed since Phase 14: nothing ever produced `Expired`, so
 * `decideTier2()`/`decideTier3()`'s `ApprovalExpiredError` branch was unreachable and
 * an approver could act on a request long past its own stated deadline. Runs every
 * 60s, matching `escalation.sla-sweep`'s cadence for the same class of work.
 */
export async function runApprovalsExpirySweep(): Promise<ReturnType<typeof sweepExpiredApprovals>> {
  return sweepExpiredApprovals();
}
