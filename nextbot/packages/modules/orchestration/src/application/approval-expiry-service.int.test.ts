import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { ApprovalAlreadyDecidedError, ApprovalExpiredError } from "@nextbot/contracts";
import { and, eq } from "drizzle-orm";
import { createSuspendedToolCall, decideTier2, decideTier3 } from "./approval-service.js";
import { expireSuspendedToolCall, sweepExpiredApprovals, TIER2_TIMEOUT_MS, TIER3_TIMEOUT_MS } from "./approval-expiry-service.js";
import { findApprovalRequestByToolCallId, findExpiredSuspendedToolCalls, findToolCallById } from "../infrastructure/tool-call-repository.js";
import type { EgressPort } from "../ports/egress.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, ADR-0013 §7.4, verification item 9)
 * — real (not mocked) integration coverage for the approval-expiry sweeper.
 *
 * The property under test is not "a column got written". It is that a branch which
 * has been present, shipped and unit-tested since Phase 14 —
 * `decideTier2()`/`decideTier3()`'s `if (existing.status === "Expired") throw new
 * ApprovalExpiredError()` — was **unreachable** because nothing in the codebase ever
 * produced the `Expired` state, and is now genuinely live. Every assertion below that
 * matters drives the real decision functions, not the repository.
 */

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

async function freshTenant(): Promise<TenantContext> {
  const ctx = await createFixtureTenant();
  createdTenantIds.push(ctx.tenantId);
  return ctx;
}

/** `createFixtureTenant` leaves `tenant.status = 'Trial'` (the column default), and
 *  `listActiveTenantContexts()` — which every cross-tenant sweep in this codebase
 *  iterates — selects `status = 'Active'` only. Flipping it is the same one-line
 *  fixture step `conversations`' idle-sweeper and `escalations`' workforce suite
 *  already use before driving their own sweeps. */
async function activateTenant(ctx: TenantContext): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) => db.update(schema.tenant).set({ status: "Active" }).where(eq(schema.tenant.id, ctx.tenantId)));
}

/** A real `channel` + `conversation` pair — `tool_call.conversation_id` is a NOT NULL
 *  FK and `conversation.channel_id` is another, so a suspended call genuinely cannot
 *  exist without both. Same shape as `@nextbot/teams`' own `createFixtureConversation`,
 *  including the random name suffix that keeps `channel_tenant_env_name_key` from
 *  colliding when two fixtures land in the same millisecond. */
async function createConversation(ctx: TenantContext): Promise<string> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const channelId = generateId();
    const suffix = `${channelId.slice(0, 8)}${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(schema.channel).values({
      id: channelId,
      tenantId: ctx.tenantId,
      type: "WebWidget",
      name: `Widget ${suffix}`,
      environment: "Sandbox",
      config: {},
      publicKey: `pk_${channelId}`,
    });
    const conversationId = generateId();
    await db.insert(schema.conversation).values({ id: conversationId, tenantId: ctx.tenantId, channelId, language: "en" });
    return conversationId;
  });
}

/** Rewinds a suspended call's own deadline into the past, which is the only way to
 *  make it "due" without sleeping for 15 minutes / 24 hours. Writes `expires_at`
 *  directly on both rows so the fixture matches exactly what `createSuspendedToolCall`
 *  would have written had it been called that long ago. */
async function backdateDeadline(ctx: TenantContext, toolCallId: string, msAgo: number): Promise<Date> {
  const past = new Date(Date.now() - msAgo);
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.update(schema.toolCall).set({ expiresAt: past }).where(and(eq(schema.toolCall.tenantId, ctx.tenantId), eq(schema.toolCall.id, toolCallId)));
    await db.update(schema.approvalRequest).set({ expiresAt: past }).where(and(eq(schema.approvalRequest.tenantId, ctx.tenantId), eq(schema.approvalRequest.toolCallId, toolCallId)));
  });
  return past;
}

/** Records every invocation so a test can assert the egress side was NEVER reached
 *  for an expired call (the whole point: an expired approval must not dispatch). */
function countingEgress(): EgressPort & { calls: number } {
  const port = {
    calls: 0,
    async invokeTool() {
      port.calls += 1;
      return { outcome: "Succeeded" as const, output: { ok: true } };
    },
  };
  return port;
}

async function suspendTier3(ctx: TenantContext, conversationId: string) {
  return createSuspendedToolCall(ctx, {
    conversationId,
    toolId: generateId(),
    toolName: "issue_refund",
    connectorId: null,
    args: { amount: 100 },
    tier: "Tier3",
  });
}

async function suspendTier2(ctx: TenantContext, conversationId: string) {
  return createSuspendedToolCall(ctx, {
    conversationId,
    toolId: generateId(),
    toolName: "update_address",
    connectorId: null,
    args: { line1: "1 Main St" },
    tier: "Tier2",
  });
}

describe("createSuspendedToolCall now stamps tool_call.expires_at for BOTH tiers", () => {
  it("writes a Tier-3 deadline on tool_call AND the identical instant on approval_request", async () => {
    const ctx = await freshTenant();
    const conversationId = await createConversation(ctx);
    const { toolCall } = await suspendTier3(ctx, conversationId);

    const stored = await findToolCallById(ctx, toolCall.id);
    const approval = await findApprovalRequestByToolCallId(ctx, toolCall.id);
    expect(stored?.expiresAt).not.toBeNull();
    expect(approval).not.toBeNull();
    // The queue UI's "expires in" and the sweeper's scan must be the SAME instant,
    // or the two surfaces can disagree about when a request stops being actionable.
    expect(stored!.expiresAt!.getTime()).toBe(approval!.expiresAt.getTime());
    // Within a generous window of the LLD §6.5 default.
    expect(Math.abs(stored!.expiresAt!.getTime() - (Date.now() + TIER3_TIMEOUT_MS))).toBeLessThan(60_000);
  });

  it("writes a Tier-2 deadline — the tier that previously had no recorded deadline at all", async () => {
    const ctx = await freshTenant();
    const conversationId = await createConversation(ctx);
    const { toolCall } = await suspendTier2(ctx, conversationId);

    const stored = await findToolCallById(ctx, toolCall.id);
    expect(stored?.expiresAt).not.toBeNull();
    expect(Math.abs(stored!.expiresAt!.getTime() - (Date.now() + TIER2_TIMEOUT_MS))).toBeLessThan(60_000);
    // Tier-2 has no queue row at all — one primitive must serve both tiers without a branch.
    expect(await findApprovalRequestByToolCallId(ctx, toolCall.id)).toBeNull();
  });
});

describe("the scan half — findExpiredSuspendedToolCalls", () => {
  it("selects a past-due suspended call and ignores a not-yet-due one", async () => {
    const ctx = await freshTenant();
    const conversationId = await createConversation(ctx);
    const due = await suspendTier3(ctx, conversationId);
    const notDue = await suspendTier3(ctx, conversationId);
    await backdateDeadline(ctx, due.toolCall.id, 1000);

    const found = await findExpiredSuspendedToolCalls(ctx, new Date());
    expect(found.map((r) => r.id)).toEqual([due.toolCall.id]);
    expect(found.map((r) => r.id)).not.toContain(notDue.toolCall.id);
  });

  it("never selects a row with a NULL expires_at — every pre-Phase-16 row keeps its old behavior", async () => {
    const ctx = await freshTenant();
    const conversationId = await createConversation(ctx);
    const { toolCall } = await suspendTier3(ctx, conversationId);
    await withTenant(ctx, async (db: TenantScopedClient) => {
      await db.update(schema.toolCall).set({ expiresAt: null }).where(eq(schema.toolCall.id, toolCall.id));
    });

    expect(await findExpiredSuspendedToolCalls(ctx, new Date(Date.now() + 10 * 365 * 24 * 3600_000))).toHaveLength(0);
  });
});

describe("expireSuspendedToolCall — the shared primitive", () => {
  it("expires a past-due Tier-3 call, its queue row, and appends a transition-log entry, in one pass", async () => {
    const ctx = await freshTenant();
    const conversationId = await createConversation(ctx);
    const { toolCall } = await suspendTier3(ctx, conversationId);
    await backdateDeadline(ctx, toolCall.id, 1000);

    const result = await expireSuspendedToolCall(ctx, toolCall.id);
    expect(result.expired).toBe(true);
    expect(result.toolCall?.status).toBe("Expired");

    const approval = await findApprovalRequestByToolCallId(ctx, toolCall.id);
    expect(approval?.status).toBe("Expired");

    const events = await withTenant(ctx, (db: TenantScopedClient) =>
      db.select().from(schema.toolCallEvent).where(eq(schema.toolCallEvent.toolCallId, toolCall.id)),
    );
    expect(events.some((e) => e.toStatus === "Expired" && e.accepted && e.actorType === "System")).toBe(true);
  });

  it("is idempotent — a second call is a no-op and emits no second domain event", async () => {
    const ctx = await freshTenant();
    const conversationId = await createConversation(ctx);
    const { toolCall } = await suspendTier3(ctx, conversationId);
    await backdateDeadline(ctx, toolCall.id, 1000);

    expect((await expireSuspendedToolCall(ctx, toolCall.id)).expired).toBe(true);
    expect((await expireSuspendedToolCall(ctx, toolCall.id)).expired).toBe(false);

    const events = await withTenant(ctx, (db: TenantScopedClient) =>
      db.select().from(schema.domainEvent).where(and(eq(schema.domainEvent.tenantId, ctx.tenantId), eq(schema.domainEvent.type, "orchestration.tool_call.expired"))),
    );
    expect(events).toHaveLength(1);
  });

  it("refuses to expire an already-decided call — a human decision always wins the race", async () => {
    const ctx = await freshTenant();
    const conversationId = await createConversation(ctx);
    const egress = countingEgress();
    const { toolCall } = await suspendTier3(ctx, conversationId);

    await decideTier3(ctx, { egress }, toolCall.id, "Rejected", "not this time", "00000000-0000-4000-8000-000000000002");
    const result = await expireSuspendedToolCall(ctx, toolCall.id);

    expect(result.expired).toBe(false);
    expect(result.toolCall?.status).toBe("Cancelled");
  });

  it("returns a clean no-op for an id that does not exist", async () => {
    const ctx = await freshTenant();
    expect(await expireSuspendedToolCall(ctx, generateId())).toEqual({ expired: false, toolCall: null });
  });
});

describe("the previously-dead ApprovalExpiredError branch is now reachable (ADR-0013 §7.4 verification item 9)", () => {
  it("Tier-3: a decision attempt after the sweep throws ApprovalExpiredError and never reaches egress", async () => {
    const ctx = await freshTenant();
    const conversationId = await createConversation(ctx);
    const egress = countingEgress();
    const { toolCall } = await suspendTier3(ctx, conversationId);
    await backdateDeadline(ctx, toolCall.id, 1000);
    await activateTenant(ctx);

    await sweepExpiredApprovals();

    expect((await findToolCallById(ctx, toolCall.id))?.status).toBe("Expired");
    await expect(decideTier3(ctx, { egress }, toolCall.id, "Approved", undefined, "00000000-0000-4000-8000-000000000002")).rejects.toBeInstanceOf(
      ApprovalExpiredError,
    );
    // The whole point of the gap: before this phase, that Approve click would have
    // CAS-ed to `Executing` and dispatched a real Tier-3 write tool.
    expect(egress.calls).toBe(0);
  });

  it("Tier-2: a Confirm after the sweep throws ApprovalExpiredError and never reaches egress", async () => {
    const ctx = await freshTenant();
    const conversationId = await createConversation(ctx);
    const egress = countingEgress();
    const { toolCall } = await suspendTier2(ctx, conversationId);
    await withTenant(ctx, async (db: TenantScopedClient) => {
      await db.update(schema.toolCall).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.toolCall.id, toolCall.id));
    });
    await activateTenant(ctx);

    await sweepExpiredApprovals();

    expect((await findToolCallById(ctx, toolCall.id))?.status).toBe("Expired");
    await expect(decideTier2(ctx, { egress }, toolCall.id, "Confirm")).rejects.toBeInstanceOf(ApprovalExpiredError);
    expect(egress.calls).toBe(0);
  });

  it("distinguishes Expired from AlreadyDecided — the two are different errors for the approver", async () => {
    const ctx = await freshTenant();
    const conversationId = await createConversation(ctx);
    const egress = countingEgress();
    const { toolCall } = await suspendTier3(ctx, conversationId);

    await decideTier3(ctx, { egress }, toolCall.id, "Rejected", "no", "00000000-0000-4000-8000-000000000002");
    await expect(decideTier3(ctx, { egress }, toolCall.id, "Approved", undefined, "00000000-0000-4000-8000-000000000002")).rejects.toBeInstanceOf(
      ApprovalAlreadyDecidedError,
    );
  });
});

describe("sweepExpiredApprovals — the cross-tenant job body", () => {
  it("expires due calls and leaves not-yet-due ones alone within the same tenant", async () => {
    const ctx = await freshTenant();
    const conversationId = await createConversation(ctx);
    const due = await suspendTier3(ctx, conversationId);
    const live = await suspendTier3(ctx, conversationId);
    await backdateDeadline(ctx, due.toolCall.id, 1000);
    await activateTenant(ctx);

    const result = await sweepExpiredApprovals();
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect((await findToolCallById(ctx, due.toolCall.id))?.status).toBe("Expired");
    expect((await findToolCallById(ctx, live.toolCall.id))?.status).toBe("AwaitingHumanApproval");
  });

  it("is safe to run twice in a row (overlapping ticks) — the second pass expires nothing new", async () => {
    const ctx = await freshTenant();
    const conversationId = await createConversation(ctx);
    const { toolCall } = await suspendTier3(ctx, conversationId);
    await backdateDeadline(ctx, toolCall.id, 1000);
    await activateTenant(ctx);

    await sweepExpiredApprovals();
    const before = await findToolCallById(ctx, toolCall.id);
    await sweepExpiredApprovals();
    const after = await findToolCallById(ctx, toolCall.id);

    expect(after?.status).toBe("Expired");
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
  });
});
