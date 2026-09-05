import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createWebWidgetChannel } from "@nextbot/channels";
import { insertConversation, findConversationById, listMessagesSince } from "@nextbot/conversations";
import { withTenant, schema, generateId, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { triggerEscalation, HUMAN_HANDOFF_CONNECTING_TEXT } from "./trigger-escalation.js";
import { claimEscalation, reassignEscalation, EscalationAlreadyClaimedError } from "./claim-escalation.js";
import { returnToBot, resolveEscalation, RETURN_TO_BOT_TEXT } from "./return-to-bot.js";
import { sendHumanAgentMessage } from "./send-human-message.js";
import { listEscalationsForAdmin } from "./list-escalations.js";
import { replaceRoutingRules } from "./routing-rules-service.js";
import { createAgentQueue } from "../infrastructure/agent-queue-repository.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

/** Creates a real agent-user row (a minimal `app_user` insert via the tenant-scoped
 * "app" role, since this test only needs a real row `findUserById` can read back —
 * not the full registration/MFA flow, which is `@nextbot/iam`'s own scope and this
 * module has no allowed dependency on it beyond the read path already re-exported). */
async function createFixtureAgentUser(ctx: TenantContext, displayName: string): Promise<string> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const [row] = await db
      .insert(schema.appUser)
      .values({ id: generateId(), tenantId: ctx.tenantId, email: `${crypto.randomUUID()}@example.com`, displayName, status: "Active" })
      .returning({ id: schema.appUser.id });
    return row!.id;
  });
}

async function setUpConversation() {
  const ctx = await createFixtureTenant();
  const channel = await createWebWidgetChannel(ctx, { name: `Widget ${crypto.randomUUID()}`, environment: "Sandbox" });
  const conversationId = await insertConversation(ctx, { channelId: channel.id, language: "en" });
  return { ctx, channel, conversationId };
}

describe("escalation lifecycle (Phase 16, BL-09, real Postgres)", () => {
  it("FR-ESC-01/03: triggering an escalation with no configured routing rules falls back to an auto-provisioned default queue, never leaving it unassigned", async () => {
    const { ctx, conversationId } = await setUpConversation();
    createdTenantIds.push(ctx.tenantId);

    const { escalation, created } = await triggerEscalation(ctx, {
      conversationId,
      reason: "LowConfidence",
      aiContextSnapshot: { recognizedGoal: "billing", confidence: 0.4 },
    });

    expect(created).toBe(true);
    expect(escalation.status).toBe("Waiting");
    expect(escalation.queueId).toBeTruthy();
    expect(escalation.matchedRoutingRuleId).toBeNull();

    const conversation = await findConversationById(ctx, conversationId);
    expect(conversation?.status).toBe("Escalated");

    const transcript = await listMessagesSince(ctx, conversationId, 0);
    const systemMessage = transcript.find((m) => m.sender === "System");
    expect(systemMessage?.payload).toMatchObject({ text: HUMAN_HANDOFF_CONNECTING_TEXT });
  });

  it("FR-ESC-03: a matching routing rule wins over the default queue", async () => {
    const { ctx, conversationId } = await setUpConversation();
    createdTenantIds.push(ctx.tenantId);
    const billingQueue = await createAgentQueue(ctx, { name: "Billing" });
    await replaceRoutingRules(ctx, [{ conditions: { reasons: ["SensitiveTopic"] }, queueId: billingQueue.id, enabled: true }]);

    const { escalation } = await triggerEscalation(ctx, {
      conversationId,
      reason: "SensitiveTopic",
      aiContextSnapshot: {},
    });

    expect(escalation.queueId).toBe(billingQueue.id);
    expect(escalation.matchedRoutingRuleId).not.toBeNull();
  });

  it("LLD §3.9: a second trigger for the same conversation while one is already active is idempotent (partial unique index), not a duplicate row", async () => {
    const { ctx, conversationId } = await setUpConversation();
    createdTenantIds.push(ctx.tenantId);

    const first = await triggerEscalation(ctx, { conversationId, reason: "ToolFailure", aiContextSnapshot: {} });
    const second = await triggerEscalation(ctx, { conversationId, reason: "LowConfidence", aiContextSnapshot: {} });

    expect(second.created).toBe(false);
    expect(second.escalation.id).toBe(first.escalation.id);

    const items = await listEscalationsForAdmin(ctx);
    expect(items.filter((i) => i.conversationId === conversationId)).toHaveLength(1);
  });

  it("real concurrency: two simultaneous 'Take Over' claims on the same escalation resolve to exactly one winner", async () => {
    const { ctx, conversationId } = await setUpConversation();
    createdTenantIds.push(ctx.tenantId);
    const { escalation } = await triggerEscalation(ctx, { conversationId, reason: "CustomerRequest", aiContextSnapshot: {} });
    const agentA = await createFixtureAgentUser(ctx, "Agent A");
    const agentB = await createFixtureAgentUser(ctx, "Agent B");

    const results = await Promise.allSettled([claimEscalation(ctx, escalation.id, agentA), claimEscalation(ctx, escalation.id, agentB)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(EscalationAlreadyClaimedError);

    const transcript = await listMessagesSince(ctx, conversationId, 0);
    const joinedMessages = transcript.filter((m) => m.sender === "System" && m.payload.text && String(m.payload.text).includes("joined"));
    expect(joinedMessages).toHaveLength(1);
  });

  it("FR-ESC-02: a claimed escalation lets the human agent send a message; FR-ESC-04 return-to-bot posts the exact copy and resumes Active", async () => {
    const { ctx, conversationId } = await setUpConversation();
    createdTenantIds.push(ctx.tenantId);
    const { escalation } = await triggerEscalation(ctx, { conversationId, reason: "CustomerRequest", aiContextSnapshot: {} });
    const agent = await createFixtureAgentUser(ctx, "Jamie");
    const claimed = await claimEscalation(ctx, escalation.id, agent);

    await sendHumanAgentMessage(ctx, claimed.id, agent, { contentType: "Text", text: "Happy to help!" });
    const midTranscript = await listMessagesSince(ctx, conversationId, 0);
    expect(midTranscript.some((m) => m.sender === "HumanAgent" && m.payload.text === "Happy to help!")).toBe(true);

    const returned = await returnToBot(ctx, claimed.id, agent);
    expect(returned.status).toBe("ReturnedToBot");
    const conversation = await findConversationById(ctx, conversationId);
    expect(conversation?.status).toBe("Active");

    const finalTranscript = await listMessagesSince(ctx, conversationId, 0);
    expect(finalTranscript.some((m) => m.sender === "System" && m.payload.text === RETURN_TO_BOT_TEXT)).toBe(true);
  });

  it("B.5.2 'Resolve & Close' ends the conversation without returning to the bot", async () => {
    const { ctx, conversationId } = await setUpConversation();
    createdTenantIds.push(ctx.tenantId);
    const { escalation } = await triggerEscalation(ctx, { conversationId, reason: "ToolFailure", aiContextSnapshot: {} });
    const agent = await createFixtureAgentUser(ctx, "Jamie");
    const claimed = await claimEscalation(ctx, escalation.id, agent);

    const resolved = await resolveEscalation(ctx, claimed.id, agent);
    expect(resolved.status).toBe("Resolved");
    const conversation = await findConversationById(ctx, conversationId);
    expect(conversation?.status).toBe("Resolved");
  });

  it("B.5.1 'Reassign' moves a still-active escalation to a different queue without changing its status", async () => {
    const { ctx, conversationId } = await setUpConversation();
    createdTenantIds.push(ctx.tenantId);
    const { escalation } = await triggerEscalation(ctx, { conversationId, reason: "ToolFailure", aiContextSnapshot: {} });
    const otherQueue = await createAgentQueue(ctx, { name: "Tier 2 Support" });

    const admin = await createFixtureAgentUser(ctx, "Admin");
    const reassigned = await reassignEscalation(ctx, escalation.id, { queueId: otherQueue.id }, admin);
    expect(reassigned.queueId).toBe(otherQueue.id);
    expect(reassigned.status).toBe("Waiting");
  });
});
