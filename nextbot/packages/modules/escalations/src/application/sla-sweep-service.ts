import { listActiveTenantContexts } from "@nextbot/tenancy";
import { findEscalationsPastSlaDue, markEscalationsSlaBreached } from "../infrastructure/escalation-repository.js";

/**
 * Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05, LLD §14.9.2) — the
 * `escalation.sla-sweep` scheduled job's real cross-tenant sweep (mirrors
 * `@nextbot/knowledge`'s own `sweepKnowledgeRetention` shape exactly: a multi-tenant
 * sweep living inside this tenant-scoped module, looping `listActiveTenantContexts()`
 * itself, rather than a composition-root orchestration in `apps/worker`).
 *
 * For every `Waiting`/`InProgress` escalation whose `sla_due_at` has passed and isn't
 * already flagged, flips `sla_breached` true. A queue with no configured
 * `sla_seconds` never produces a `sla_due_at` in the first place (see
 * `trigger-escalation.ts`), so this sweep naturally never touches those rows.
 */
export interface EscalationSlaSweepResult {
  tenantsChecked: number;
  escalationsBreached: number;
}

export async function sweepEscalationSla(): Promise<EscalationSlaSweepResult> {
  const tenants = await listActiveTenantContexts();
  let escalationsBreached = 0;
  const now = new Date();

  for (const ctx of tenants) {
    // A single tenant's failure must never abort the whole sweep tick for every other
    // tenant — matches `tenancy.retention-purge`/`knowledge.retention-purge`'s own
    // per-tenant isolation convention.
    try {
      const due = await findEscalationsPastSlaDue(ctx, now);
      if (due.length === 0) continue;
      const count = await markEscalationsSlaBreached(ctx, due.map((e) => e.id));
      escalationsBreached += count;
    } catch (err) {
      console.error(`NextBot worker: escalation SLA sweep failed for tenant "${ctx.tenantId}"`, err);
    }
  }

  return { tenantsChecked: tenants.length, escalationsBreached };
}
