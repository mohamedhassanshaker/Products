import { and, asc, eq } from "drizzle-orm";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { TrafficAllocationCandidate } from "../domain/traffic-bucket.js";

/**
 * Persistence for the Phase 17 traffic-split resolver (BL-48, ADR-0019 §2.3,
 * LLD §15.2/§15.3): the sticky `deployment_traffic_assignment` row and the ordered read
 * of a triple's currently-active deployments.
 */

/** A sticky assignment that is still honourable — i.e. its deployment is still active. */
export interface LiveTrafficAssignment {
  deploymentId: string;
  agentDefinitionVersionId: string;
}

/**
 * Reads this conversation's sticky assignment **only if the deployment it points at is
 * still `is_active`**.
 *
 * The `is_active` predicate in this one query is the entire mechanism behind ADR-0019's
 * most consequential rule. Promotion, split change, ordinary rollback and emergency
 * rollback all deactivate rows; because a deactivated deployment can never satisfy this
 * predicate, every one of those actions causes the *next* turn of every in-flight
 * conversation to fall through to a fresh weighted resolution against the new active set
 * — inside NFR-2's <5s bound, with no cache to invalidate and no sweep to wait for.
 * A stickiness that survived deactivation would make emergency rollback silently
 * ineffective for exactly the conversations experiencing the bad version.
 *
 * @param ctx tenant context.
 * @param conversationId the conversation whose assignment is being read.
 * @param agentDefinitionId the agent definition being resolved.
 * @returns the still-live assignment, or `null` when there is none *or* when the one
 *   that exists points at a deployment that has since been deactivated (both cases
 *   correctly mean "re-resolve").
 */
export async function findLiveTrafficAssignment(
  ctx: TenantContext,
  conversationId: string,
  agentDefinitionId: string,
): Promise<LiveTrafficAssignment | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({
        deploymentId: schema.deploymentTrafficAssignment.deploymentId,
        agentDefinitionVersionId: schema.deploymentTrafficAssignment.agentDefinitionVersionId,
      })
      .from(schema.deploymentTrafficAssignment)
      .innerJoin(schema.deployment, eq(schema.deployment.id, schema.deploymentTrafficAssignment.deploymentId))
      .where(
        and(
          eq(schema.deploymentTrafficAssignment.tenantId, ctx.tenantId),
          eq(schema.deploymentTrafficAssignment.conversationId, conversationId),
          eq(schema.deploymentTrafficAssignment.agentDefinitionId, agentDefinitionId),
          eq(schema.deployment.isActive, true),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  });
}

/**
 * The active deployments for one `(tenant, agentDefinition, environment)`, **ordered by
 * `deployment.id`** — the ordering LLD §15.3 step 3 mandates so the weighted walk is
 * stable across processes and repeated reads without any coordination between replicas.
 */
export async function listActiveDeploymentAllocations(
  ctx: TenantContext,
  agentDefinitionId: string,
  environment: "Sandbox" | "Staging" | "Production",
): Promise<TrafficAllocationCandidate[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({
        deploymentId: schema.deployment.id,
        agentDefinitionVersionId: schema.deployment.agentDefinitionVersionId,
        trafficSplitPct: schema.deployment.trafficSplitPct,
      })
      .from(schema.deployment)
      .where(
        and(
          eq(schema.deployment.tenantId, ctx.tenantId),
          eq(schema.deployment.agentDefinitionId, agentDefinitionId),
          eq(schema.deployment.environment, environment as never),
          eq(schema.deployment.isActive, true),
        ),
      )
      .orderBy(asc(schema.deployment.id));
    return rows;
  });
}

/**
 * Records (or re-points) this conversation's sticky assignment.
 *
 * `ON CONFLICT … DO UPDATE` rather than delete-then-insert so a concurrent second turn of
 * the same conversation cannot transiently observe "no assignment" and resolve
 * independently. Both concurrent turns compute the *same* deterministic bucket anyway, so
 * whichever write lands last writes the same values.
 */
export async function upsertTrafficAssignment(
  ctx: TenantContext,
  input: { conversationId: string; agentDefinitionId: string; deploymentId: string; agentDefinitionVersionId: string },
): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db
      .insert(schema.deploymentTrafficAssignment)
      .values({
        tenantId: ctx.tenantId,
        conversationId: input.conversationId,
        agentDefinitionId: input.agentDefinitionId,
        deploymentId: input.deploymentId,
        agentDefinitionVersionId: input.agentDefinitionVersionId,
      })
      .onConflictDoUpdate({
        target: [
          schema.deploymentTrafficAssignment.tenantId,
          schema.deploymentTrafficAssignment.conversationId,
          schema.deploymentTrafficAssignment.agentDefinitionId,
        ],
        set: {
          deploymentId: input.deploymentId,
          agentDefinitionVersionId: input.agentDefinitionVersionId,
          assignedAt: new Date(),
        },
      }),
  );
}
