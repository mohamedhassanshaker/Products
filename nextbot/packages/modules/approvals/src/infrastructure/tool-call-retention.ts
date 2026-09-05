import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/**
 * QA fix (BE-2, FR-ADM-06) — `tenant_data_policy.retention_tool_payloads_days`
 * enforcement. `tool_call` has no separate "payload" table: the payload fields
 * (`input_args`, `input_args_masked`, `output`, `error_message`, `decision_note`)
 * live on the same row as the call's identity/metadata fields (`tool_name`,
 * `status`, `connector_id`, timestamps). Enforcing the payload category
 * independently of the metadata category therefore means *redacting* those
 * payload-bearing columns in place once they age past the payload retention
 * cutoff, while leaving the row (and its metadata) intact for the metadata
 * category's own, separately-configured retention window to govern.
 *
 * Idempotent: re-running against an already-redacted row is a no-op write of the
 * same empty values, so at-least-once scheduling (see `apps/worker/src/
 * scheduler.ts`'s module doc) cannot double-redact or corrupt anything.
 */
export async function redactToolCallPayloadsOlderThan(ctx: TenantContext, cutoff: Date): Promise<number> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const matches = await db
      .select({ id: schema.toolCall.id })
      .from(schema.toolCall)
      .where(
        and(
          eq(schema.toolCall.tenantId, ctx.tenantId),
          sql`${schema.toolCall.createdAt} < ${cutoff}`,
          sql`${schema.toolCall.inputArgs} <> '{}'::jsonb`,
        ),
      );
    const ids = matches.map((m) => m.id);
    if (ids.length === 0) return 0;

    await db
      .update(schema.toolCall)
      .set({
        inputArgs: {},
        inputArgsMasked: null,
        output: null,
        errorMessage: null,
        decisionNote: null,
      })
      .where(and(eq(schema.toolCall.tenantId, ctx.tenantId), inArray(schema.toolCall.id, ids)));

    return ids.length;
  });
}

/**
 * QA fix (BE-2, FR-ADM-06) — `tenant_data_policy.retention_tool_metadata_days`
 * enforcement. This is the "metadata" category's own, independent retention: once
 * a `tool_call` row (identity + status + timestamps + whatever payload remains)
 * ages past this cutoff, the row and its dependents (`tool_call_event`,
 * `approval_request` — both FK-reference `tool_call.id` with no cascade, so
 * children must be deleted first) are hard-deleted entirely.
 *
 * Deliberately independent of the payload cutoff: a tenant can (and typically
 * will) configure `retention_tool_metadata_days` longer than
 * `retention_tool_payloads_days` (keep an audit trail of *that a* call happened
 * long after its sensitive payload is gone) or shorter (rare, but not this
 * function's business to prevent — it enforces whatever the admin configured).
 */
export async function purgeToolCallMetadataOlderThan(ctx: TenantContext, cutoff: Date): Promise<number> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const matches = await db
      .select({ id: schema.toolCall.id })
      .from(schema.toolCall)
      .where(and(eq(schema.toolCall.tenantId, ctx.tenantId), sql`${schema.toolCall.createdAt} < ${cutoff}`));
    const ids = matches.map((m) => m.id);
    if (ids.length === 0) return 0;

    await db.delete(schema.toolCallEvent).where(and(eq(schema.toolCallEvent.tenantId, ctx.tenantId), inArray(schema.toolCallEvent.toolCallId, ids)));
    await db.delete(schema.approvalRequest).where(and(eq(schema.approvalRequest.tenantId, ctx.tenantId), inArray(schema.approvalRequest.toolCallId, ids)));
    await db.delete(schema.toolCall).where(and(eq(schema.toolCall.tenantId, ctx.tenantId), inArray(schema.toolCall.id, ids)));

    return ids.length;
  });
}
