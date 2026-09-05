import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./tenancy.js";

/**
 * Target Architecture Blueprint Phase 6 (BL-37, ADR-0012, LLD §14.2.6) —
 * **tenant_scope_policy**, the one table `@nextbot/authz` owns. This is the
 * tenant-level floor fed into every `evaluate()`/`evaluateOrDeny()` call as
 * `input.tenantPolicy` — the outermost fold level nothing in the chain can widen
 * past.
 *
 * **Derived, not hand-edited** (LLD's own words): `scope_json` is a
 * `ScopeDescriptorSchema` with `origin: 'TenantPolicy'`, computed from whatever
 * tenant-level tables already carry a *real* value for a given dimension —
 * everything else stays at that dimension's `⊤` (no constraint), never a guessed
 * or hardcoded default.
 *
 * **Disclosed narrowing of LLD §14.2.6's literal derivation list**: the LLD says
 * this row is rebuilt from `tenant_data_policy` (residency/`allowOutOfRegion
 * Inference`), `pii_policy` (→ `maskingFloor`) and `tenant_runtime_quota`
 * (→ `budget`), reconciled hourly by a `config.changed` worker consumer. This
 * phase implements the `tenant_data_policy → allowOutOfRegionInference` mapping
 * only — `tenant_runtime_quota`'s existing columns (`maxConcurrentRuns`,
 * `maxTokensPerMinute`, `maxToolCallsPerSecond`, `maxConcurrentConversations`,
 * `maxMcpConnectors`) do not correspond to any field of the evaluator's `budget`
 * dimension (`usdPerTurn`/`seconds`/`maxSteps`/`maxDepth`/`maxFanOut`/
 * `maxDelegations`/`maxHops`/`maxExpansions` — those are run/delegation-tree
 * concepts `team_version.limits_json` will own once Module E ships, not tenant
 * runtime-shaping concepts), so `budget` is left at `⊤` at the tenant-policy level
 * for now (E9 already requires the evaluator to treat an all-`undefined` budget as
 * `+∞` and explicitly NOT be the platform's cost backstop, so this is safe).
 * `pii_policy`'s matrix is keyed by `(entityType, context, trustLevel)`, not by
 * `context` alone — collapsing it to one `maskingFloor` value per context would
 * require an aggregation rule (e.g. "strictest across every entity/trust
 * combination") the LLD does not specify, so `maskingFloor` is also left at `⊤`
 * this phase rather than inventing one; PII masking itself is still fully enforced
 * independently by `@nextbot/pii`'s own masker at every existing call site — this
 * only concerns the *evaluator's* re-masking-at-delegation-boundary dimension,
 * which has no live call site yet (Phase 14).
 *
 * Rather than a scheduled hourly reconciler job, this phase computes `scope_json`
 * fresh on every read (`getTenantScopePolicy`, `@nextbot/authz`) and upserts it —
 * strictly stronger than "reconciled hourly" (always exactly current, at the cost
 * of one extra indexed point-lookup per read instead of a cache hit), and avoids
 * a new write-time coupling into `tenancy`'s own `tenant_data_policy` mutation
 * path this phase does not touch.
 */
export const tenantScopePolicy = pgTable("tenant_scope_policy", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenant.id),
  scopeJson: jsonb("scope_json").notNull(),
  scopeHash: text("scope_hash").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
