import { eq } from "drizzle-orm";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { ScopeDescriptor } from "@nextbot/contracts";
import { listPiiPolicies } from "@nextbot/pii";
import { hashScopeInput } from "../domain/scope-hash.js";
import { meetMaskingFloor } from "../domain/scope-lattice.js";

/**
 * LLD §14.2.6 — `tenant_scope_policy`, the tenant-level floor fed into every
 * `evaluate()` call as `input.tenantPolicy`.
 *
 * **Derived, not hand-edited.** This phase computes `scope_json` fresh on every
 * read rather than reacting to writes on `tenant_data_policy`/`pii_policy`/
 * `tenant_runtime_quota` (the LLD's literal "rebuilt in the same transaction as
 * any write..., reconciled hourly by a worker" design) — see
 * `packages/db/src/schema/authz.ts`'s doc comment for the full, disclosed
 * rationale (in short: `tenant_runtime_quota`'s existing columns don't correspond
 * to any `budget` dimension field, and `pii_policy`'s matrix can't be collapsed to
 * one `maskingFloor` value per context without an aggregation rule the LLD
 * doesn't specify — so only `tenant_data_policy.allowOutOfRegionInference` is
 * derived this phase; every other dimension stays at `⊤`). Recomputing on every
 * read is strictly stronger than an hourly reconciler (always exactly current)
 * and needs no new write-time coupling into `tenancy`'s own transactions.
 *
 * **Target Architecture Blueprint Phase 12 update (BL-43/44, FR-AGT-14, LLD
 * §14.5.6) — `maskingFloor` derived for real.** FR-AGT-14's guardrail
 * tightening-only invariant (`domain/guardrail-tightening.ts#assertTightensOnly`)
 * needs a real per-context tenant floor to compare an authored version's own
 * `spec.maskingFloor` against — leaving this dimension at `⊤` forever would make
 * that check permanently unable to fire for masking, the exact scenario
 * FR-AGT-14's own worked example names ("downgrading a masking-context entry
 * from Full Mask to Show"). This closes the gap this doc comment itself
 * earmarked above, using the aggregation rule it named as the missing piece:
 * **strictest action across every `(entityType, trustLevel)` combination for a
 * given context**, folded via `meetMaskingFloor` — the SAME per-context
 * "stricter wins" comparison the lattice's own fold already uses
 * (`scope-lattice.ts`), never a second, independently-derived comparison. A
 * context with NO `pii_policy` row at all stays absent from the resulting
 * record (`⊤` for that specific context, per E3 "absent ⇒ no constraint") —
 * deliberately distinct from the runtime masker's own separate fail-closed
 * "no row ⇒ FullMask" default (`pii_policy`'s own schema doc comment), which
 * this change does not touch.
 */
async function deriveTenantMaskingFloor(ctx: TenantContext): Promise<Record<string, string>> {
  const policies = await listPiiPolicies(ctx);
  let floor: Record<string, string> = {};
  for (const policy of policies) {
    floor = meetMaskingFloor(floor, { [policy.context]: policy.action });
  }
  return floor;
}

export async function getTenantScopePolicy(ctx: TenantContext): Promise<ScopeDescriptor> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const [dataPolicyRow] = await db
      .select({ allowOutOfRegionInference: schema.tenantDataPolicy.allowOutOfRegionInference })
      .from(schema.tenantDataPolicy)
      .where(eq(schema.tenantDataPolicy.tenantId, ctx.tenantId));

    const maskingFloor = await deriveTenantMaskingFloor(ctx);

    const scope: ScopeDescriptor = {
      origin: "TenantPolicy",
      originId: "tenant",
      originLabel: "Tenant default policy",
      // Every other dimension is omitted here deliberately — omitted means `⊤`
      // (LLD §14.2.1's E3: "absent ⇒ inherits the caller/imposes no constraint"),
      // which is the honest representation for every dimension this phase has no
      // real tenant-level source of truth for yet (see this file's doc comment).
      allowOutOfRegionInference: dataPolicyRow?.allowOutOfRegionInference ?? true,
      ...(Object.keys(maskingFloor).length > 0 ? { maskingFloor: maskingFloor as ScopeDescriptor["maskingFloor"] } : {}),
    };
    const scopeHash = hashScopeInput(scope);

    await db
      .insert(schema.tenantScopePolicy)
      .values({ tenantId: ctx.tenantId, scopeJson: scope, scopeHash })
      .onConflictDoUpdate({
        target: schema.tenantScopePolicy.tenantId,
        set: { scopeJson: scope, scopeHash, updatedAt: new Date() },
      });

    return scope;
  });
}

/** Test/diagnostic helper — reads the persisted row verbatim (no recompute),
 * so a test can assert the derived value was actually written, not merely
 * returned in memory. */
export async function readPersistedTenantScopePolicy(ctx: TenantContext): Promise<{ scopeJson: unknown; scopeHash: string } | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const [row] = await db
      .select({ scopeJson: schema.tenantScopePolicy.scopeJson, scopeHash: schema.tenantScopePolicy.scopeHash })
      .from(schema.tenantScopePolicy)
      .where(eq(schema.tenantScopePolicy.tenantId, ctx.tenantId));
    return row ?? null;
  });
}
