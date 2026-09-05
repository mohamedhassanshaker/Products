import { and, asc, desc, eq, sql } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

export interface DeploymentRow {
  id: string;
  tenantId: string;
  agentDefinitionId: string;
  agentDefinitionVersionId: string;
  environment: "Sandbox" | "Staging" | "Production";
  trafficSplitPct: number;
  isActive: boolean;
}

/** Creates the (sole) active Production deployment for a freshly `Approved ->
 * Production` version, at 100% traffic (full canary/traffic-split editing — running
 * more than one active deployment at partial percentages side by side — is BL-13's
 * unbuilt Deployment & Canary Manager; this phase only needs "promoting a version
 * replaces whatever was previously live" to actually work, which is the promise the
 * console's own promotion-confirmation dialog already makes, per LLD §3.10).
 *
 * QA fix (client-feedback-batch Phase 7, 2026-08-21 batch): this used to
 * unconditionally INSERT a new active 100%-traffic row without first deactivating
 * the agent's prior active deployment for this environment. For any agent that
 * already had a live Production deployment — the normal case once Phase 7's
 * Restore feature lets an author create and promote a follow-up version — the two
 * active rows' `traffic_split_pct` would sum to 200, and
 * `enforce_deployment_traffic_split_invariant()` (migration 0016) correctly rejected
 * the INSERT as an unhandled 500. The fix: within this same transaction, first
 * deactivate every currently-active deployment for
 * (tenantId, agentDefinitionId, environment) — an `UPDATE ... WHERE is_active = true`
 * takes a row lock on each matched row, so a second, concurrent call for the same
 * agent/environment blocks on that lock until the first commits, then re-evaluates
 * its own `is_active = true` predicate against the now-committed data (Postgres
 * re-checks the row's current values under READ COMMITTED) rather than acting on a
 * stale snapshot — so the trigger's invariant is never transiently violated by two
 * promotions racing for the same agent+environment. The old row's replacement is
 * recorded as `fromState` on the same `deployment_history` "Deploy" entry the new
 * row's `toState` already went into (append-only audit trail; no new enum value
 * needed for "replaced" — BL-13 can introduce a dedicated action later if it needs
 * one for a real multi-row canary timeline).
 *
 * A row-lock on the *existing* active deployment alone isn't enough: when an agent
 * has **zero** prior active deployment for this environment (its genuinely first
 * promotion, or two never-yet-deployed versions racing each other), there is no row
 * for either transaction to lock, so nothing serializes them, and a real (rare, but
 * observed under a tight concurrent-repro loop while verifying this fix) race let
 * two concurrent calls each `INSERT` their own active 100%-traffic row before either
 * committed — the trigger only validates against already-*committed* rows, so
 * neither insert saw the other and both passed, leaving the invariant violated at
 * 200% once both committed. A `pg_advisory_xact_lock` keyed on
 * (tenantId, agentDefinitionId, environment) closes that gap unconditionally: it's
 * held only for this transaction's lifetime (released automatically on
 * commit/rollback, never needs an explicit unlock) and serializes *every* call to
 * this function for the same agent+environment, whether or not a prior row exists.
 */
export async function createInitialProductionDeployment(
  ctx: TenantContext,
  input: { agentDefinitionId: string; agentDefinitionVersionId: string; environment: "Sandbox" | "Staging" | "Production"; actorUserId: string | null },
): Promise<DeploymentRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    // Serialize every promotion-to-this-environment for this agent, closing the
    // "zero prior deployment" race described above. The key itself is built by the
    // shared `deploymentLockKey` helper (Phase 17) so this writer, emergency rollback,
    // `setTrafficSplit` and `promoteCanary` are provably taking the SAME lock rather
    // than four independently-spelled strings that could drift apart.
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${deploymentLockKey(ctx.tenantId, input.agentDefinitionId, input.environment)}))`);

    // Deactivate whatever was previously serving this agent/environment's traffic
    // *before* inserting the new row, in the same transaction, so the trigger never
    // observes a moment where both rows are simultaneously active (which is what
    // would push the sum over 100 and raise). `.returning()` also gives us the
    // deactivated row(s) for the history entry's `fromState`, at no extra query cost.
    const deactivated = await db
      .update(schema.deployment)
      .set({ isActive: false, deactivatedAt: new Date() })
      .where(
        and(
          eq(schema.deployment.tenantId, ctx.tenantId),
          eq(schema.deployment.agentDefinitionId, input.agentDefinitionId),
          eq(schema.deployment.environment, input.environment as never),
          eq(schema.deployment.isActive, true),
        ),
      )
      .returning({ agentDefinitionVersionId: schema.deployment.agentDefinitionVersionId, trafficSplitPct: schema.deployment.trafficSplitPct });

    const id = generateId();
    await db.insert(schema.deployment).values({
      id,
      tenantId: ctx.tenantId,
      agentDefinitionId: input.agentDefinitionId,
      agentDefinitionVersionId: input.agentDefinitionVersionId,
      environment: input.environment as never,
      trafficSplitPct: 100,
      isActive: true,
    });
    await db.insert(schema.deploymentHistory).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      agentDefinitionId: input.agentDefinitionId,
      // Phase 6 (BL-27, ADR-0017 §5) — required for `hasEverBeenProductionInHistory`'s
      // eligibility query to find this promotion later. Every ordinary `Deploy` row
      // now carries the version it deployed, not only the later `EmergencyRollback`
      // rows this migration was originally added for.
      agentDefinitionVersionId: input.agentDefinitionVersionId,
      environment: input.environment as never,
      action: "Deploy",
      fromState: deactivated.length > 0 ? { replaced: deactivated } : null,
      toState: { agentDefinitionVersionId: input.agentDefinitionVersionId, trafficSplitPct: 100 },
      reason:
        deactivated.length > 0
          ? "Promotion replaced the prior active Production deployment (100% traffic cutover)."
          : "Initial production deployment on promotion.",
      actorUserId: input.actorUserId,
    });
    // Target Architecture Blueprint Phase 18 (BL-49, FR-API-02) — the outbound-webhook
    // subscriber's "deployment changed" category. This is the single most common
    // deployment-change path (a version's first promotion to Production, or a later
    // promotion that replaces whatever was previously live) and, confirmed by
    // inspection before this phase, was the one deployment-repository writer with NO
    // domain_event emission at all — `emergencyRollbackRepoint`/`setTrafficSplit`
    // already emit their own (`agent-platform.emergency_rollback`/
    // `agent-platform.canary_promoted`/`agent-platform.traffic_split_changed`).
    // Appended in the same transaction as the deployment row above.
    await db.insert(schema.domainEvent).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      type: "agent-platform.deployment_created",
      payload: {
        actorId: input.actorUserId,
        actorLabel: input.actorUserId ?? "system",
        actionType: "Deployment",
        targetType: "agent_definition_version",
        targetId: input.agentDefinitionVersionId,
        agentDefinitionId: input.agentDefinitionId,
        environment: input.environment,
        trafficSplitPct: 100,
        replacedPriorDeployment: deactivated.length > 0,
      },
    });

    const [row] = await db.select().from(schema.deployment).where(eq(schema.deployment.id, id));
    if (!row) throw new Error("createInitialProductionDeployment: insert did not return a row");
    return row as DeploymentRow;
  });
}

/**
 * ADR-0017 §2.1's eligibility query, verbatim: does this version have a
 * `deployment_history` row proving it was **already promoted to Production** at some
 * point (`Deploy`/`PromoteCanary`/`Rollback`/`EmergencyRollback`, in the `Production`
 * environment)? Deliberately checked against **history**, never the version's current
 * `status` column — a version that was Production and has since been superseded (its
 * status may now even read `Deprecated`) still qualifies, which is exactly ADR-0017's
 * point: "it already passed the gate then."
 *
 * Older `deployment_history` rows predating this migration have `agent_definition_
 * version_id = NULL` (the column didn't exist yet) — such a row can never match this
 * query's `= $1` filter, which is the correct, conservative behavior: a version whose
 * only historical evidence is a pre-migration row with no recorded version id is
 * treated as not-yet-proven-eligible rather than guessed at.
 */
export async function hasEverBeenProductionInHistory(ctx: TenantContext, agentDefinitionVersionId: string): Promise<boolean> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ id: schema.deploymentHistory.id })
      .from(schema.deploymentHistory)
      .where(
        and(
          eq(schema.deploymentHistory.tenantId, ctx.tenantId),
          eq(schema.deploymentHistory.agentDefinitionVersionId, agentDefinitionVersionId),
          eq(schema.deploymentHistory.environment, "Production"),
          sql`${schema.deploymentHistory.action} IN ('Deploy', 'PromoteCanary', 'Rollback', 'EmergencyRollback')`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  });
}

/**
 * ADR-0017 §2.2/§2.3 — the emergency-rollback repoint itself: a **repoint, not a
 * redeploy** (same traffic-split row update plus Redis-cache-bust profile as ordinary
 * promotion/rollback, so it inherits the same <5s NFR-2/NFR-13 bound), executed under
 * the exact same advisory-lock pattern `createInitialProductionDeployment` already
 * uses (serializes concurrent calls for the same agent+environment so two racing
 * emergency rollbacks can never both leave an active row — the same regression test
 * that covers ordinary promotion concurrency covers this path too, since it is the
 * same lock key and the same deactivate-then-insert shape).
 *
 * The audit-log/notification obligation (ADR-0017 §2.2 — "never a silent action") is
 * met structurally here, not as a call-site courtesy: the `domain_event` outbox row is
 * written in the **same transaction** as the repoint and the `deployment_history` row,
 * so a crash between them is impossible — either all three commit or none do.
 *
 * **Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.7) — unchanged, and
 * deliberately so.** Phase 17 introduced the first writers that can leave *several*
 * simultaneously-active `deployment` rows (`setTrafficSplit`/`promoteCanary`), which
 * raises the obvious question of whether rollback still works against an N-row canary.
 * It does, with no code change: the `UPDATE … WHERE is_active = true` below matches
 * **all** active rows, so a 90/10 canary collapses to a single 100% row exactly as a
 * 1-row deployment does; and because the sticky assignment is bounded by the assigned
 * deployment's `is_active` lifetime, every in-flight conversation re-resolves to the
 * rolled-back version on its *next* turn. Phase 17 therefore added the adversarial
 * **test** that proves both (`deployment-canary-rollback.int.test.ts`), not new rollback
 * code. The only edit made to this function was routing its advisory-lock key through the
 * shared `deploymentLockKey` helper so the four writers' mutual exclusion is provable
 * rather than four copies of the same string.
 */
export async function emergencyRollbackRepoint(
  ctx: TenantContext,
  input: { agentDefinitionId: string; targetVersionId: string; reason: string; actorUserId: string | null },
): Promise<DeploymentRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    // Phase 17 (BL-48): the key now comes from the shared `deploymentLockKey` helper, so
    // this rollback and the new `setTrafficSplit`/`promoteCanary` writers are provably
    // mutually exclusive for the same agent+environment — the property ADR-0019 §2.7
    // calls non-negotiable, and the one the N-row-canary rollback test exercises for real.
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${deploymentLockKey(ctx.tenantId, input.agentDefinitionId, "Production")}))`);

    const deactivated = await db
      .update(schema.deployment)
      .set({ isActive: false, deactivatedAt: new Date() })
      .where(
        and(
          eq(schema.deployment.tenantId, ctx.tenantId),
          eq(schema.deployment.agentDefinitionId, input.agentDefinitionId),
          eq(schema.deployment.environment, "Production"),
          eq(schema.deployment.isActive, true),
        ),
      )
      .returning({ agentDefinitionVersionId: schema.deployment.agentDefinitionVersionId, trafficSplitPct: schema.deployment.trafficSplitPct });

    const id = generateId();
    await db.insert(schema.deployment).values({
      id,
      tenantId: ctx.tenantId,
      agentDefinitionId: input.agentDefinitionId,
      agentDefinitionVersionId: input.targetVersionId,
      environment: "Production",
      trafficSplitPct: 100,
      isActive: true,
    });

    const historyId = generateId();
    await db.insert(schema.deploymentHistory).values({
      id: historyId,
      tenantId: ctx.tenantId,
      agentDefinitionId: input.agentDefinitionId,
      agentDefinitionVersionId: input.targetVersionId,
      environment: "Production",
      action: "EmergencyRollback",
      fromState: deactivated.length > 0 ? { replaced: deactivated } : null,
      toState: { agentDefinitionVersionId: input.targetVersionId, trafficSplitPct: 100 },
      reason: input.reason,
      actorUserId: input.actorUserId,
    });

    // Transactional-outbox row (LLD §2.4) — the structural "never silent" guarantee
    // ADR-0017 §2.2 requires. `apps/worker`'s existing audit-sync consumer mirrors this
    // into `audit_log_entry`; the admin-notification/FR-API-02 `deployment changed`
    // webhook consumers read the same event once those delivery mechanisms exist
    // (webhooks are BL-49/Phase 18 — out of this phase's scope, disclosed here rather
    // than silently assumed built).
    await db.insert(schema.domainEvent).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      type: "agent-platform.emergency_rollback",
      payload: {
        actorId: input.actorUserId,
        actorLabel: input.actorUserId ?? "system",
        actionType: "Deployment",
        targetType: "agent_definition_version",
        targetId: input.targetVersionId,
        agentDefinitionId: input.agentDefinitionId,
        reason: input.reason,
        deploymentHistoryId: historyId,
      },
    });

    const [row] = await db.select().from(schema.deployment).where(eq(schema.deployment.id, id));
    if (!row) throw new Error("emergencyRollbackRepoint: insert did not return a row");
    return row as DeploymentRow;
  });
}

/**
 * The `(tenant, agentDefinition, environment)` advisory-lock key **shared by every writer
 * of `deployment`** — `createInitialProductionDeployment`, `emergencyRollbackRepoint`,
 * `setTrafficSplit` and `promoteCanary`.
 *
 * Non-negotiable and deliberately centralized here (Target Architecture Blueprint
 * Phase 17, BL-48, ADR-0019 §2.7 / LLD §15.4 step 1): that the four use the *same* key is
 * the entire reason a split change, a promotion and an emergency rollback for the same
 * agent+environment can never interleave. Before Phase 17 the string was spelled out
 * inline at two call sites; adding two more writers made a shared constructor the only
 * honest way to keep them provably identical. `hashtext` collapses it into the single
 * bigint `pg_advisory_xact_lock` takes; a hash collision with an unrelated key would only
 * ever cause extra, harmless serialization (never a missed lock).
 */
function deploymentLockKey(tenantId: string, agentDefinitionId: string, environment: string): string {
  return `${tenantId}:${agentDefinitionId}:${environment}`;
}

/** One requested allocation for `setTrafficSplit`. */
export interface TrafficSplitAllocation {
  agentDefinitionVersionId: string;
  trafficSplitPct: number;
}

/**
 * **The first multi-row-active writer in this codebase's history** (Target Architecture
 * Blueprint Phase 17, BL-48, absorbing BL-13's never-built Deployment & Canary Manager
 * core; ADR-0019 §2.7, LLD §15.4).
 *
 * Until this function existed, `createInitialProductionDeployment` and
 * `emergencyRollbackRepoint` were the only writers of `deployment` and both produced
 * exactly one active 100%-traffic row — so `deployment.traffic_split_pct`, the
 * `SUM(...)=100` trigger from migration `0016`, and the `SplitChange`/`PromoteCanary`
 * values that have sat unwritten in `deployment_action` since `0014` all described a
 * capability nothing could actually exercise. This is that capability.
 *
 * One transaction, in this exact order (the shape the two existing writers already use,
 * extended from one row to N):
 *
 * 1. `pg_advisory_xact_lock` on {@link deploymentLockKey} — **the same key** promotion and
 *    emergency rollback take, so the three are mutually exclusive per agent+environment.
 *    Held only for this transaction (released automatically on commit/rollback).
 * 2. Deactivate every currently-active row, `.returning()` for the history entry's
 *    `fromState`. Doing this *before* the inserts means the `0016` trigger never observes
 *    a moment where the old and new sets are simultaneously active.
 * 3. Insert one row per allocation.
 * 4. One `deployment_history` row with the real `SplitChange`/`PromoteCanary` action.
 * 5. One `domain_event` outbox row **in the same transaction** — the structural "never
 *    silent" guarantee, mirroring `emergencyRollbackRepoint` exactly: a crash between the
 *    repoint and its audit record is impossible, because either all of 2–5 commit or none
 *    do.
 *
 * Allocation *shape* validation (sums to 100, no duplicates, 1..100 each) is
 * `domain/traffic-split-policy.ts`'s job and the version-eligibility gate (every allocated
 * version already holds `Production`) is `application/traffic-split-service.ts`'s — both
 * run before this function. The `0016` trigger remains the database-level backstop, so a
 * future caller that skipped both still cannot violate the invariant.
 *
 * @param ctx tenant context.
 * @param input the agent definition, environment, allocation set, audit reason and actor.
 * @param action `SplitChange` for an ordinary split edit, `PromoteCanary` for the
 *   collapse-to-100% action (see {@link promoteCanary}) — the only difference between the
 *   two is which already-existing `deployment_action` value the history row carries and
 *   which outbox event type is emitted.
 * @returns the newly-active deployment rows, in insertion order.
 */
export async function setTrafficSplit(
  ctx: TenantContext,
  input: {
    agentDefinitionId: string;
    environment: "Sandbox" | "Staging" | "Production";
    allocations: TrafficSplitAllocation[];
    reason: string;
    actorUserId: string | null;
  },
  action: "SplitChange" | "PromoteCanary" = "SplitChange",
): Promise<DeploymentRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${deploymentLockKey(ctx.tenantId, input.agentDefinitionId, input.environment)}))`);

    const deactivated = await db
      .update(schema.deployment)
      .set({ isActive: false, deactivatedAt: new Date() })
      .where(
        and(
          eq(schema.deployment.tenantId, ctx.tenantId),
          eq(schema.deployment.agentDefinitionId, input.agentDefinitionId),
          eq(schema.deployment.environment, input.environment as never),
          eq(schema.deployment.isActive, true),
        ),
      )
      .returning({ agentDefinitionVersionId: schema.deployment.agentDefinitionVersionId, trafficSplitPct: schema.deployment.trafficSplitPct });

    const inserted: DeploymentRow[] = [];
    for (const allocation of input.allocations) {
      const id = generateId();
      await db.insert(schema.deployment).values({
        id,
        tenantId: ctx.tenantId,
        agentDefinitionId: input.agentDefinitionId,
        agentDefinitionVersionId: allocation.agentDefinitionVersionId,
        environment: input.environment as never,
        trafficSplitPct: allocation.trafficSplitPct,
        isActive: true,
      });
      const [row] = await db.select().from(schema.deployment).where(eq(schema.deployment.id, id));
      if (!row) throw new Error("setTrafficSplit: insert did not return a row");
      inserted.push(row as DeploymentRow);
    }

    // The "majority/target" version this history row is attributed to (LLD §15.4 step 5).
    // For `PromoteCanary` that is the single 100% target; for a `SplitChange` it is
    // whichever version took the largest share, which is what a rollout timeline reads
    // most naturally ("split changed, mostly v3"). Ties resolve to the first allocation,
    // which is the caller's own ordering and therefore stable.
    const majority = [...input.allocations].sort((a, b) => b.trafficSplitPct - a.trafficSplitPct)[0]!;

    const historyId = generateId();
    await db.insert(schema.deploymentHistory).values({
      id: historyId,
      tenantId: ctx.tenantId,
      agentDefinitionId: input.agentDefinitionId,
      agentDefinitionVersionId: majority.agentDefinitionVersionId,
      environment: input.environment as never,
      action,
      fromState: deactivated.length > 0 ? { replaced: deactivated } : null,
      toState: { allocations: input.allocations },
      reason: input.reason,
      actorUserId: input.actorUserId,
    });

    // Transactional outbox (LLD §2.4) — the same structural audit guarantee ADR-0017 §2.2
    // requires of emergency rollback, applied to the two new deployment actions.
    // `apps/worker`'s existing audit-sync consumer mirrors this into `audit_log_entry`.
    await db.insert(schema.domainEvent).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      type: action === "PromoteCanary" ? "agent-platform.canary_promoted" : "agent-platform.traffic_split_changed",
      payload: {
        actorId: input.actorUserId,
        actorLabel: input.actorUserId ?? "system",
        actionType: "Deployment",
        targetType: "agent_definition",
        targetId: input.agentDefinitionId,
        environment: input.environment,
        allocations: input.allocations,
        replaced: deactivated,
        reason: input.reason,
        deploymentHistoryId: historyId,
      },
    });

    return inserted;
  });
}

/**
 * FR-AGT-04's "Promote canary to 100%" (Phase 17, BL-48/BL-13, LLD §15.4).
 *
 * Collapses the current split to a single 100% allocation on `agentDefinitionVersionId`,
 * deactivating every other active row — the same shape as `emergencyRollbackRepoint`,
 * differing only in that it is an ordinary admin action rather than an emergency
 * gate-bypass, so it is recorded as `PromoteCanary` rather than `EmergencyRollback` and
 * carries no eligibility-bypass semantics at all.
 *
 * Delegates to {@link setTrafficSplit} rather than duplicating the transaction, so it
 * provably takes the same advisory lock, writes the same-shaped history row, and emits
 * the same-shaped outbox event.
 */
export async function promoteCanary(
  ctx: TenantContext,
  input: {
    agentDefinitionId: string;
    environment: "Sandbox" | "Staging" | "Production";
    agentDefinitionVersionId: string;
    reason: string;
    actorUserId: string | null;
  },
): Promise<DeploymentRow[]> {
  return setTrafficSplit(
    ctx,
    {
      agentDefinitionId: input.agentDefinitionId,
      environment: input.environment,
      allocations: [{ agentDefinitionVersionId: input.agentDefinitionVersionId, trafficSplitPct: 100 }],
      reason: input.reason,
      actorUserId: input.actorUserId,
    },
    "PromoteCanary",
  );
}

/** The `deployment_history` timeline for one agent definition — the rollout view backing
 *  the Deployments & Canary panel (LLD §15.7/§15.8). Includes `EmergencyRollback` rows,
 *  already written by Phase 0, so an emergency action is visible in the same timeline as
 *  the ordinary ones and is labelled distinctly (ADR-0017 §2.5). */
export async function listDeploymentHistory(
  ctx: TenantContext,
  agentDefinitionId: string,
  environment: "Sandbox" | "Staging" | "Production",
  limit = 50,
) {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.deploymentHistory)
      .where(
        and(
          eq(schema.deploymentHistory.tenantId, ctx.tenantId),
          eq(schema.deploymentHistory.agentDefinitionId, agentDefinitionId),
          eq(schema.deploymentHistory.environment, environment as never),
        ),
      )
      .orderBy(desc(schema.deploymentHistory.createdAt))
      .limit(limit),
  );
}

/** The currently-active allocation set for one agent+environment, ordered by
 *  `deployment.id` — the same ordering the resolver walks, so the deployments screen shows
 *  the split in the exact order traffic is bucketed into it. */
export async function listActiveDeploymentsForAgentEnvironment(
  ctx: TenantContext,
  agentDefinitionId: string,
  environment: "Sandbox" | "Staging" | "Production",
): Promise<DeploymentRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.deployment)
      .where(
        and(
          eq(schema.deployment.tenantId, ctx.tenantId),
          eq(schema.deployment.agentDefinitionId, agentDefinitionId),
          eq(schema.deployment.environment, environment as never),
          eq(schema.deployment.isActive, true),
        ),
      )
      .orderBy(asc(schema.deployment.id)),
  ) as Promise<DeploymentRow[]>;
}

export async function hasActiveTraffic(ctx: TenantContext, agentDefinitionVersionId: string): Promise<boolean> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ trafficSplitPct: schema.deployment.trafficSplitPct })
      .from(schema.deployment)
      .where(
        and(
          eq(schema.deployment.tenantId, ctx.tenantId),
          eq(schema.deployment.agentDefinitionVersionId, agentDefinitionVersionId),
          eq(schema.deployment.isActive, true),
        ),
      );
    return rows.some((r) => (r.trafficSplitPct ?? 0) > 0);
  });
}

export async function listDeploymentsForAgent(ctx: TenantContext, agentDefinitionId: string): Promise<DeploymentRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.deployment).where(and(eq(schema.deployment.tenantId, ctx.tenantId), eq(schema.deployment.agentDefinitionId, agentDefinitionId))),
  ) as Promise<DeploymentRow[]>;
}

/** Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-17) — every currently
 * ACTIVE Production deployment for this tenant, one row per `agent_definition`
 * with live Production traffic — the "currently-deployed Production version"
 * `apps/worker`'s `eval.continuous-run` job schedules a run against, distinct
 * from whichever version happens to be under review. */
export async function listActiveProductionDeployments(ctx: TenantContext): Promise<DeploymentRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.deployment)
      .where(and(eq(schema.deployment.tenantId, ctx.tenantId), eq(schema.deployment.environment, "Production"), eq(schema.deployment.isActive, true))),
  ) as Promise<DeploymentRow[]>;
}
