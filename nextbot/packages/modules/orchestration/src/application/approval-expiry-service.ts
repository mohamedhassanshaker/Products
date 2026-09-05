import { listActiveTenantContexts } from "@nextbot/tenancy";
import type { TenantContext } from "@nextbot/db";
import { claimToolCallExpiry, findExpiredSuspendedToolCalls, type ToolCallRow } from "../infrastructure/tool-call-repository.js";
import { appendDomainEvent } from "../infrastructure/domain-event-repository.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, ADR-0013 §7.4, LLD §14.6.2's
 * corrected job table) — **the Tier-2/Tier-3 approval-expiry sweeper**, a real
 * pre-existing gap this codebase has disclosed in `approval-service.ts`'s own header
 * comment since Phase 14:
 *
 * > "Tier-2's 900s timeout (LLD §6.4 default) has no expiry-sweeper this phase …
 * > Tier-3's timeout below is still recorded on `approval_request.expires_at` even
 * > though nothing sweeps it yet."
 *
 * The consequence of that gap is not cosmetic. `decideTier2()`/`decideTier3()` have
 * always begun with `if (existing.status === "Expired") throw new
 * ApprovalExpiredError()` — a branch that was **unreachable**, because nothing in the
 * codebase ever produced the `Expired` state. This module is what makes that
 * already-shipped, already-tested code live: without it, a Tier-3 request stays
 * actionable in the Approval Queue forever, and an approver clicking Approve a week
 * past the request's own stated deadline CAS-es it to `Executing` and dispatches a
 * real write tool.
 *
 * It is folded into Phase 16 rather than deferred because ADR-0013 §2.3 routes a
 * workflow Human-task suspension into this **same** queue ("there is no third
 * queue"). Two independently-timed expiry mechanisms would be two clocks that can
 * disagree about the same suspension; one shared mechanism is the only correct
 * outcome. `@nextbot/workflows`' `workflow.suspension-expiry-sweep` calls
 * `expireSuspendedToolCall` below rather than writing `tool_call` itself.
 *
 * Shape copied from `escalation.sla-sweep` (`sweepEscalationSla()`, Phase 13) — a
 * real, shipped, due-date sweep over a tenant-scoped table that loops
 * `listActiveTenantContexts()` itself, so `withTenant`'s RLS holds for every read and
 * write. Not from the `a2a.input-required-sweep` the superseded LLD text named, which
 * has never existed.
 */

/** LLD §6.4's default Tier-2 (customer-confirmation) timeout. Exported so
 *  `createSuspendedToolCall` and this sweep can never disagree about the deadline. */
export const TIER2_TIMEOUT_MS = 900 * 1000;

/** LLD §6.5's default Tier-3 (human-approval) timeout. */
export const TIER3_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export interface ApprovalExpiryResult {
  /** Whether THIS call won the CAS (`false` = already decided, already expired, or
   *  never suspended — all of which are correct no-ops, not failures). */
  expired: boolean;
  toolCall: ToolCallRow | null;
}

/**
 * Expires ONE suspended tool call, if it is still suspended.
 *
 * This is the single primitive both `approvals.expiry-sweep` and
 * `@nextbot/workflows`' `workflow.suspension-expiry-sweep` go through, so a workflow
 * run and the Approval Queue can never hold two different opinions about whether a
 * given suspension is still live.
 *
 * @param ctx tenant context.
 * @param toolCallId the `tool_call.id` to expire.
 * @returns `{ expired, toolCall }` — `expired: false` when the row was already
 *   decided/terminal or does not exist. Never throws for those cases: speculative,
 *   repeated calls are the intended usage pattern.
 */
export async function expireSuspendedToolCall(ctx: TenantContext, toolCallId: string): Promise<ApprovalExpiryResult> {
  const { expired, row } = await claimToolCallExpiry(ctx, toolCallId);
  if (expired && row) {
    // Emitted only by the CAS winner, so a redundant sweep tick never produces a
    // second event for the same expiry (the outbox is consumed by `audit`, which
    // would otherwise show one approval expiring N times).
    await appendDomainEvent(ctx, {
      type: "orchestration.tool_call.expired",
      payload: {
        toolCallId: row.id,
        toolId: row.toolId,
        toolName: row.toolName,
        tier: row.approvalTier,
        conversationId: row.conversationId,
        expiresAt: row.expiresAt?.toISOString() ?? null,
      },
    });
  }
  return { expired, toolCall: row };
}

export interface ApprovalExpirySweepResult {
  tenantsChecked: number;
  /** Rows that were genuinely still suspended and are now `Expired`. */
  expired: number;
}

/**
 * The `approvals.expiry-sweep` scheduled job's cross-tenant sweep (60s tick).
 *
 * Retroactive by construction: it scans `tool_call.expires_at` over *all* suspended
 * calls, so on its very first tick it also closes the gap for ordinary (non-workflow)
 * conversations whose Tier-2/Tier-3 calls are genuinely past due — with no separate
 * code path, which is exactly why ADR-0013 §7.4 declined to defer this to its own
 * backlog item.
 *
 * @param asOf the instant to compare deadlines against; defaults to now. Injected so
 *   integration tests can drive the boundary without sleeping.
 * @returns how many tenants were scanned and how many calls this tick expired.
 */
export async function sweepExpiredApprovals(asOf: Date = new Date()): Promise<ApprovalExpirySweepResult> {
  const tenants = await listActiveTenantContexts();
  let expired = 0;

  for (const ctx of tenants) {
    // One tenant's failure must never abort the tick for every other tenant — the
    // same per-tenant isolation convention `escalation.sla-sweep` and both retention
    // purges already follow.
    try {
      const due = await findExpiredSuspendedToolCalls(ctx, asOf);
      for (const call of due) {
        const result = await expireSuspendedToolCall(ctx, call.id);
        if (result.expired) expired += 1;
      }
    } catch (err) {
      console.error(`NextBot worker: approval expiry sweep failed for tenant "${ctx.tenantId}"`, err);
    }
  }

  return { tenantsChecked: tenants.length, expired };
}
