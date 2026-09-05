import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { generateId, schema, withTenant, type TenantContext } from "@nextbot/db";
import { syncAuditFromEventsForTenant } from "./sync-audit-from-events.js";
import { queryAuditLog } from "./query-audit.js";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-08) — "audit as a chain".
 *
 * `audit_log_entry.actor` for a delegated tool call becomes `agent:<toVersionLabel>`
 * with `detail.delegationChain` carrying the full path and `correlation_id =
 * otel_trace_id`. **The `actor` column's SHAPE is unchanged** — the chain lives in
 * `detail` — so no existing audit query breaks. That last clause is the point of
 * this suite: it is asserted against a real, already-shipped audit query, not just
 * claimed.
 *
 * `teams` cannot import `audit` (LLD §2.3: audit is reached only via domain events,
 * never a direct import), so this half of the FR-ORC-08 contract is verified here,
 * on the consuming side. The producing side — that the delegated tool call really
 * emits this payload — is verified in `@nextbot/teams`'
 * `delegation-not-customer-visible.int.test.ts`.
 */
async function appendEvent(ctx: TenantContext, type: string, payload: Record<string, unknown>): Promise<void> {
  await withTenant(ctx, (db) => db.insert(schema.domainEvent).values({ id: generateId(), tenantId: ctx.tenantId, type, payload }));
}

const CHAIN = [
  { depth: 0, agentLabel: "triage@14", memberKey: null, reason: "supervisor routing", outcome: null },
  { depth: 1, agentLabel: "billing_agent@9", memberKey: "billing", reason: "billing question", outcome: null },
];

describe("audit outbox consumer — FR-ORC-08 delegated-action attribution (real Postgres)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("attributes a delegated tool call to the TERMINAL agent and carries the chain in `details`", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const runId = generateId();
    const toolCallId = generateId();

    await appendEvent(ctx, "orchestration.tool_call.awaiting_human_approval", {
      toolCallId,
      toolName: "issue_refund",
      actorLabel: "agent:billing_agent@9",
      delegationChain: CHAIN,
      correlationId: runId,
      targetType: "tool_call",
      targetId: toolCallId,
    });

    expect(await syncAuditFromEventsForTenant(ctx)).toEqual({ synced: 1 });
    const [entry] = await queryAuditLog(ctx, {});
    expect(entry).toBeDefined();
    // The actor COLUMN is still a plain text label — same type, same column, no new
    // column, no structural change any existing reader would notice.
    expect(typeof entry!.actorLabel).toBe("string");
    expect(entry!.actorLabel).toBe("agent:billing_agent@9");
    expect(entry!.targetType).toBe("tool_call");
    expect(entry!.targetId).toBe(toolCallId);
    // The chain itself is in `details`.
    const details = entry!.details as { delegationChain?: typeof CHAIN; correlationId?: string };
    expect(details.delegationChain?.map((c) => c.agentLabel)).toEqual(["triage@14", "billing_agent@9"]);
    expect(details.correlationId).toBe(runId);
  });

  it("leaves a NON-delegated event's attribution exactly as it was — `system`", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await appendEvent(ctx, "orchestration.tool_call.awaiting_human_approval", { toolCallId: generateId(), toolName: "plain_tool" });

    await syncAuditFromEventsForTenant(ctx);
    const [entry] = await queryAuditLog(ctx, {});
    expect(entry!.actorLabel).toBe("system");
    expect((entry!.details as { delegationChain?: unknown }).delegationChain).toBeUndefined();
  });

  it("EXISTING audit queries still work unchanged across both kinds (no query breaks)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const delegatedToolCallId = generateId();
    await appendEvent(ctx, "orchestration.tool_call.awaiting_human_approval", { toolCallId: generateId(), toolName: "plain_tool" });
    await appendEvent(ctx, "orchestration.tool_call.awaiting_human_approval", {
      toolCallId: delegatedToolCallId,
      toolName: "issue_refund",
      actorLabel: "agent:billing_agent@9",
      delegationChain: CHAIN,
      correlationId: generateId(),
      targetType: "tool_call",
      targetId: delegatedToolCallId,
    });
    await appendEvent(ctx, "orchestration.tool_call.policy_denied", { toolCallId: generateId(), toolName: "blocked_tool" });
    await syncAuditFromEventsForTenant(ctx);

    // 1. The `actionType` filter — unchanged, and finds BOTH approval events.
    const byAction = await queryAuditLog(ctx, { actionType: "orchestration.tool_call.awaiting_human_approval" });
    expect(byAction).toHaveLength(2);

    // 2. The `outcome` derivation — unchanged (a "denied"-typed event is still Denied).
    const denied = await queryAuditLog(ctx, { outcome: "Denied" });
    expect(denied).toHaveLength(1);
    expect((denied[0]!.details as { toolName?: string }).toolName).toBe("blocked_tool");

    // 3. The `targetType`/`targetId` filter — now genuinely populated for a delegated
    //    call, and still returns nothing surprising for the others.
    const byTarget = await queryAuditLog(ctx, { targetType: "tool_call" });
    expect(byTarget).toHaveLength(1);
    expect(byTarget[0]!.actorLabel).toBe("agent:billing_agent@9");

    // 4. The full-text `search` filter — the chain's own labels are searchable
    //    because they ride in `details`, without any change to how search works.
    const bySearch = await queryAuditLog(ctx, { search: "billing_agent" });
    expect(bySearch.length).toBeGreaterThanOrEqual(1);
  });
});
