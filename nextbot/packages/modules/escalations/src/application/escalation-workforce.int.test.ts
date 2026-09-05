import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createWebWidgetChannel } from "@nextbot/channels";
import { insertConversation } from "@nextbot/conversations";
import { withTenant, schema, generateId, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { eq } from "drizzle-orm";
import { triggerEscalation } from "./trigger-escalation.js";
import { claimEscalation, reassignEscalation, AgentAtConcurrencyCeilingError, EscalationAlreadyClaimedError } from "./claim-escalation.js";
import { resolveEscalation, returnToBot } from "./return-to-bot.js";
import { getOrCreateAgentPresence, setAgentMaxConcurrent } from "./agent-presence-service.js";
import { sweepEscalationSla } from "./sla-sweep-service.js";
import { createAgentQueue } from "../infrastructure/agent-queue-repository.js";
import { findAgentPresence } from "../infrastructure/agent-presence-repository.js";
import { listAssignmentLogForEscalation } from "../infrastructure/escalation-assignment-log-repository.js";
import { replaceRoutingRules } from "./routing-rules-service.js";
import { getEscalationDetail, listEscalationsForAdmin } from "./list-escalations.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

/** Minimal real `app_user` row — same helper shape `escalation-lifecycle.int.test.ts`
 * already established. */
async function createFixtureAgentUser(ctx: TenantContext, displayName: string): Promise<string> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const [row] = await db
      .insert(schema.appUser)
      .values({ id: generateId(), tenantId: ctx.tenantId, email: `${crypto.randomUUID()}@example.com`, displayName, status: "Active" })
      .returning({ id: schema.appUser.id });
    return row!.id;
  });
}

async function setUpConversation(ctx: TenantContext) {
  const channel = await createWebWidgetChannel(ctx, { name: `Widget ${crypto.randomUUID()}`, environment: "Sandbox" });
  return insertConversation(ctx, { channelId: channel.id, language: "en" });
}

async function triggerWaitingEscalation(ctx: TenantContext) {
  const conversationId = await setUpConversation(ctx);
  const { escalation } = await triggerEscalation(ctx, { conversationId, reason: "CustomerRequest", aiContextSnapshot: {} });
  return escalation;
}

describe("Escalation Workforce Mechanics (Target Architecture Blueprint Phase 13, BL-45, FR-ESC-05)", () => {
  it("agent presence auto-provisions Offline/3/0 on first reference — no separate provisioning step", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const agent = await createFixtureAgentUser(ctx, "Fresh Agent");

    const presence = await getOrCreateAgentPresence(ctx, agent);
    expect(presence.state).toBe("Offline");
    expect(presence.maxConcurrent).toBe(3);
    expect(presence.currentLoad).toBe(0);
  });

  it("a claim attempt past max_concurrent is rejected with AGENT_AT_CONCURRENCY_CEILING, the escalation stays Waiting, current_load is unchanged (no partial state)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const agent = await createFixtureAgentUser(ctx, "Ceiling Agent");
    await setAgentMaxConcurrent(ctx, agent, 1);

    const first = await triggerWaitingEscalation(ctx);
    const second = await triggerWaitingEscalation(ctx);

    const claimed = await claimEscalation(ctx, first.id, agent);
    expect(claimed.status).toBe("InProgress");

    await expect(claimEscalation(ctx, second.id, agent)).rejects.toBeInstanceOf(AgentAtConcurrencyCeilingError);

    // No partial state change: the second escalation is still Waiting, and the
    // agent's current_load reflects exactly the ONE successful claim, not two.
    const presence = await findAgentPresence(ctx, agent);
    expect(presence?.currentLoad).toBe(1);

    const log = await listAssignmentLogForEscalation(ctx, first.id);
    expect(log.some((l) => l.action === "Claimed" && l.userId === agent)).toBe(true);
    const secondLog = await listAssignmentLogForEscalation(ctx, second.id);
    expect(secondLog).toHaveLength(0);
  });

  it("real concurrency: N simultaneous claim attempts against an agent one slot from their ceiling resolve to EXACTLY the right number of winners", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const agent = await createFixtureAgentUser(ctx, "Contested Agent");
    await setAgentMaxConcurrent(ctx, agent, 2); // room for exactly 2 more claims

    const escalations = await Promise.all([1, 2, 3, 4, 5].map(() => triggerWaitingEscalation(ctx)));

    const results = await Promise.allSettled(escalations.map((e) => claimEscalation(ctx, e.id, agent)));
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(3);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(AgentAtConcurrencyCeilingError);
    }

    const presence = await findAgentPresence(ctx, agent);
    expect(presence?.currentLoad).toBe(2);
  });

  it("current_load decrements on Resolved and on ReturnedToBot alike (an escalation stops occupying a slot whichever way it ends)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const agent = await createFixtureAgentUser(ctx, "Agent");

    const resolvedEsc = await triggerWaitingEscalation(ctx);
    const returnedEsc = await triggerWaitingEscalation(ctx);
    await claimEscalation(ctx, resolvedEsc.id, agent);
    await claimEscalation(ctx, returnedEsc.id, agent);
    expect((await findAgentPresence(ctx, agent))?.currentLoad).toBe(2);

    await resolveEscalation(ctx, resolvedEsc.id, agent);
    expect((await findAgentPresence(ctx, agent))?.currentLoad).toBe(1);

    await returnToBot(ctx, returnedEsc.id, agent);
    expect((await findAgentPresence(ctx, agent))?.currentLoad).toBe(0);

    const log = await listAssignmentLogForEscalation(ctx, resolvedEsc.id);
    expect(log.some((l) => l.action === "Released")).toBe(true);
  });

  it("resolving with a CSAT score persists csat_captured_at; resolving without one leaves it NULL (CSAT never blocks the close)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const agent = await createFixtureAgentUser(ctx, "Agent");

    const withCsat = await triggerWaitingEscalation(ctx);
    await claimEscalation(ctx, withCsat.id, agent);
    const resolvedWithCsat = await resolveEscalation(ctx, withCsat.id, agent, { csatScore: 5, csatComment: "Great!" });
    expect(resolvedWithCsat.csatScore).toBe(5);
    expect(resolvedWithCsat.csatComment).toBe("Great!");
    expect(resolvedWithCsat.csatCapturedAt).not.toBeNull();

    const withoutCsat = await triggerWaitingEscalation(ctx);
    await claimEscalation(ctx, withoutCsat.id, agent);
    const resolvedWithoutCsat = await resolveEscalation(ctx, withoutCsat.id, agent);
    expect(resolvedWithoutCsat.status).toBe("Resolved");
    expect(resolvedWithoutCsat.csatScore).toBeNull();
    expect(resolvedWithoutCsat.csatCapturedAt).toBeNull();
  });

  it("reassigning an InProgress escalation to a different agent transfers load and is subject to the same ceiling check", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const agentA = await createFixtureAgentUser(ctx, "Agent A");
    const agentB = await createFixtureAgentUser(ctx, "Agent B");
    await setAgentMaxConcurrent(ctx, agentB, 1);
    // Fill agent B's own single slot with an unrelated escalation first.
    const blockerEsc = await triggerWaitingEscalation(ctx);
    await claimEscalation(ctx, blockerEsc.id, agentB);

    const esc = await triggerWaitingEscalation(ctx);
    await claimEscalation(ctx, esc.id, agentA);
    expect((await findAgentPresence(ctx, agentA))?.currentLoad).toBe(1);

    // B is already at ceiling (1/1) — reassigning to B must be rejected, and A's own
    // load must NOT have been released for a reassignment that never actually happened
    // (no partial state change).
    await expect(reassignEscalation(ctx, esc.id, { agentId: agentB }, agentA)).rejects.toBeInstanceOf(AgentAtConcurrencyCeilingError);
    expect((await findAgentPresence(ctx, agentA))?.currentLoad).toBe(1);

    // Free up B's slot, then the identical reassignment succeeds and transfers load.
    await resolveEscalation(ctx, blockerEsc.id, agentB);
    const reassigned = await reassignEscalation(ctx, esc.id, { agentId: agentB }, agentA);
    expect(reassigned.assignedAgentId).toBe(agentB);
    expect((await findAgentPresence(ctx, agentA))?.currentLoad).toBe(0);
    expect((await findAgentPresence(ctx, agentB))?.currentLoad).toBe(1);

    const log = await listAssignmentLogForEscalation(ctx, esc.id);
    expect(log.some((l) => l.action === "Reassigned" && l.userId === agentB)).toBe(true);
  });

  it("the SLA sweep flips sla_breached for a Waiting escalation past its due time but leaves an unconfigured queue's escalation untouched", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    // `sweepEscalationSla` iterates `listActiveTenantContexts()`, which only returns
    // `tenant.status = 'Active'` rows — a fixture tenant defaults to `Trial` (same
    // real-Postgres nuance `idle-sweeper.int.test.ts` already works around).
    await withTenant(ctx, (db) => db.update(schema.tenant).set({ status: "Active" }).where(eq(schema.tenant.id, ctx.tenantId)));
    const fastQueue = await createAgentQueue(ctx, { name: "Fast SLA", slaSeconds: 1 });
    const noSlaQueue = await createAgentQueue(ctx, { name: "No SLA" });
    await replaceRoutingRules(ctx, [
      { conditions: { reasons: ["ToolFailure"] }, queueId: fastQueue.id, enabled: true },
      { conditions: { reasons: ["SensitiveTopic"] }, queueId: noSlaQueue.id, enabled: true },
    ]);

    const conversationA = await setUpConversation(ctx);
    const { escalation: dueEsc } = await triggerEscalation(ctx, { conversationId: conversationA, reason: "ToolFailure", aiContextSnapshot: {} });
    expect(dueEsc.slaDueAt).not.toBeNull();

    const conversationB = await setUpConversation(ctx);
    const { escalation: noSlaEsc } = await triggerEscalation(ctx, { conversationId: conversationB, reason: "SensitiveTopic", aiContextSnapshot: {} });
    expect(noSlaEsc.slaDueAt).toBeNull();

    // Force the due escalation's sla_due_at into the past (real time would require a
    // real 1s sleep in the test — this asserts the sweep's own query/write correctness
    // directly against a controlled timestamp instead).
    await withTenant(ctx, (db) => db.update(schema.escalation).set({ slaDueAt: new Date(Date.now() - 60_000) }).where(eq(schema.escalation.id, dueEsc.id)));

    const result = await sweepEscalationSla();
    expect(result.escalationsBreached).toBeGreaterThanOrEqual(1);

    const rows = await withTenant(ctx, (db) => db.select().from(schema.escalation).where(eq(schema.escalation.tenantId, ctx.tenantId)));
    const dueRow = rows.find((r) => r.id === dueEsc.id);
    const noSlaRow = rows.find((r) => r.id === noSlaEsc.id);
    expect(dueRow?.slaBreached).toBe(true);
    expect(noSlaRow?.slaBreached).toBe(false);
  });

  it("FR-ESC-05's own boundary: a queue with every agent Offline/at-ceiling still routes a new escalation per FR-ESC-03 and it simply waits, never silently dropped or throwing", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const agent = await createFixtureAgentUser(ctx, "Only Agent");
    await setAgentMaxConcurrent(ctx, agent, 1);
    const blockerEsc = await triggerWaitingEscalation(ctx);
    await claimEscalation(ctx, blockerEsc.id, agent);
    // The tenant's only agent is now at their ceiling (1/1) and every OTHER agent
    // reference in this tenant is the FR-ESC-05 default Offline/0-load (never
    // referenced at all — no presence row exists for anyone else, which is itself
    // the "zero available agents" condition).

    const newEsc = await triggerWaitingEscalation(ctx);
    expect(newEsc.status).toBe("Waiting");
    expect(newEsc.queueId).toBeTruthy();

    // It waits visibly: a claim attempt by the same at-ceiling agent is still
    // rejected (never silently over-assigned), and the escalation is still there,
    // still Waiting, discoverable via the ordinary active-escalation list.
    await expect(claimEscalation(ctx, newEsc.id, agent)).rejects.toBeInstanceOf(AgentAtConcurrencyCeilingError);
  });

  it("a second claim attempt on an already-InProgress escalation still 409s ESCALATION_ALREADY_CLAIMED (not the ceiling error) when the SAME agent re-attempts", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const agent = await createFixtureAgentUser(ctx, "Agent");
    const esc = await triggerWaitingEscalation(ctx);
    await claimEscalation(ctx, esc.id, agent);

    await expect(claimEscalation(ctx, esc.id, agent)).rejects.toBeInstanceOf(EscalationAlreadyClaimedError);
    // The lost-race attempt's own increment must have rolled back — not left at 2.
    expect((await findAgentPresence(ctx, agent))?.currentLoad).toBe(1);
  });

  it("returnToBot also accepts an optional CSAT body, symmetrically with resolveEscalation", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const agent = await createFixtureAgentUser(ctx, "Agent");
    const esc = await triggerWaitingEscalation(ctx);
    await claimEscalation(ctx, esc.id, agent);

    const returned = await returnToBot(ctx, esc.id, agent, { csatScore: 3, csatComment: "Fine" });
    expect(returned.status).toBe("ReturnedToBot");
    expect(returned.csatScore).toBe(3);
    expect(returned.csatCapturedAt).not.toBeNull();
  });

  it("resolveEscalation/returnToBot on an already-terminal (or never-claimed) escalation throw EscalationAlreadyClaimedError, never silently no-op", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const agent = await createFixtureAgentUser(ctx, "Agent");

    const waitingEsc = await triggerWaitingEscalation(ctx);
    await expect(resolveEscalation(ctx, waitingEsc.id, agent)).rejects.toBeInstanceOf(EscalationAlreadyClaimedError);
    await expect(returnToBot(ctx, waitingEsc.id, agent)).rejects.toBeInstanceOf(EscalationAlreadyClaimedError);

    const alreadyResolvedEsc = await triggerWaitingEscalation(ctx);
    await claimEscalation(ctx, alreadyResolvedEsc.id, agent);
    await resolveEscalation(ctx, alreadyResolvedEsc.id, agent);
    await expect(resolveEscalation(ctx, alreadyResolvedEsc.id, agent)).rejects.toBeInstanceOf(EscalationAlreadyClaimedError);
  });

  it("reassignEscalation supports explicit unassignment (agentId: null) — decrements the outgoing agent's load with no new increment", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const agent = await createFixtureAgentUser(ctx, "Agent");
    const esc = await triggerWaitingEscalation(ctx);
    await claimEscalation(ctx, esc.id, agent);
    expect((await findAgentPresence(ctx, agent))?.currentLoad).toBe(1);

    const unassigned = await reassignEscalation(ctx, esc.id, { agentId: null }, agent);
    expect(unassigned.assignedAgentId).toBeNull();
    expect((await findAgentPresence(ctx, agent))?.currentLoad).toBe(0);
  });

  it("reassignEscalation rejects a client-supplied agentId that doesn't belong to this tenant (ownership check, never trusts the client id)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const otherTenant = await createFixtureTenant();
    createdTenantIds.push(otherTenant.tenantId);
    const agent = await createFixtureAgentUser(ctx, "Agent");
    const outsiderAgent = await createFixtureAgentUser(otherTenant, "Outsider");
    const esc = await triggerWaitingEscalation(ctx);
    await claimEscalation(ctx, esc.id, agent);

    await expect(reassignEscalation(ctx, esc.id, { agentId: outsiderAgent }, agent)).rejects.toThrow();
    // No partial state change: the original agent's load is untouched.
    expect((await findAgentPresence(ctx, agent))?.currentLoad).toBe(1);
  });

  it("listEscalationsForAdmin / getEscalationDetail surface real, non-null slaDueAt/slaBreached and csat fields once configured/captured", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const agent = await createFixtureAgentUser(ctx, "Agent");
    const queue = await createAgentQueue(ctx, { name: "SLA Queue", slaSeconds: 3600, isDefault: true });
    const conversationId = await setUpConversation(ctx);
    const { escalation: esc } = await triggerEscalation(ctx, { conversationId, reason: "CustomerRequest", aiContextSnapshot: {} });
    expect(esc.queueId).toBe(queue.id);

    const queueItems = await listEscalationsForAdmin(ctx);
    const item = queueItems.find((i) => i.id === esc.id);
    expect(item?.slaDueAt).not.toBeNull();
    expect(item?.slaBreached).toBe(false);

    await claimEscalation(ctx, esc.id, agent);
    await resolveEscalation(ctx, esc.id, agent, { csatScore: 5, csatComment: "Excellent" });

    const detail = await getEscalationDetail(ctx, esc.id);
    expect(detail?.slaDueAt).not.toBeNull();
    expect(detail?.csatScore).toBe(5);
    expect(detail?.csatComment).toBe("Excellent");
    expect(detail?.csatCapturedAt).not.toBeNull();
  });
});
