import { describe, expect, it } from "vitest";
import { FakeCitizenIdentityRepository } from "../../identity/testing/fakes.js";
import {
  FakeCannedReplyRepository,
  FakeConversationRepository,
  FakeTicketRepository,
} from "../testing/fakes.js";
import { GetTicketDetail, TicketNotFoundError } from "./get-ticket-detail.js";

const handoverAt = new Date("2026-09-10T10:00:00.000Z");
const afterHandoverAt = new Date("2026-09-10T10:02:00.000Z");

describe("GetTicketDetail — never a cold start", () => {
  it("carries forward the full live transcript, the identity/assurance state, and the pending slot", async () => {
    const tickets = new FakeTicketRepository();
    const conversations = new FakeConversationRepository();
    const citizenIdentities = new FakeCitizenIdentityRepository();
    const cannedReplies = new FakeCannedReplyRepository();

    citizenIdentities.seed({
      id: "cid_1",
      assuranceLevel: "VerifiedPlusOtp",
      emiratesIdHash: null,
      mobileHash: "hash_mobile",
      displayNameMasked: "Ahmed R.",
      verifiedByProviderKey: "uae_pass",
      verifiedAt: handoverAt,
      verificationExpiresAt: null,
      erasedAt: null,
    });

    conversations.seedConversation({
      id: "conv_1",
      channelKey: "WebWidget",
      localeCode: "en",
      outcome: "Escalated",
      turnCount: 3,
      startedAt: handoverAt,
      lastTurnAt: afterHandoverAt,
      endedAt: null,
    });
    // Turn 1-2 existed at the moment of handover; turn 3 is what the citizen said
    // *after* requesting a human — proving the transcript is live, not frozen.
    conversations.seedTurns("conv_1", [
      {
        id: "turn_1",
        conversationId: "conv_1",
        ordinal: 1,
        role: "Citizen",
        contentMasked: "My SEWA bill seems wrong",
        contentFormat: "Text",
        createdAt: handoverAt,
        wasRefused: false,
        refusalReason: null,
      },
      {
        id: "turn_2",
        conversationId: "conv_1",
        ordinal: 2,
        role: "Assistant",
        contentMasked: "Let me get a human agent for you.",
        contentFormat: "Text",
        createdAt: handoverAt,
        wasRefused: false,
        refusalReason: null,
      },
      {
        id: "turn_3",
        conversationId: "conv_1",
        ordinal: 3,
        role: "Citizen",
        contentMasked: "Also, my account number is 4821",
        contentFormat: "Text",
        createdAt: afterHandoverAt,
        wasRefused: false,
        refusalReason: null,
      },
    ]);

    tickets.seed({
      id: "t1",
      conversationId: "conv_1",
      topic: "SEWA billing",
      topicKey: "Billing",
      channelKey: "WebWidget",
      priority: "Normal",
      reason: "ToolFailure",
      reasonDetail: "get_bill failed twice.",
      status: "Queued",
      routeTargetTeamId: null,
      assignedStaffUserId: null,
      queuedAt: handoverAt,
      wasRequeued: false,
      verificationState: "VerifiedPlusOtp",
      citizenIdentityId: "cid_1",
      pendingSlotName: "sewa_account_number",
      contextSnapshotJson: JSON.stringify({
        turns: [{ role: "Citizen", contentMasked: "My SEWA bill seems wrong", ordinal: 1 }],
        pendingSlot: { name: "sewa_account_number" },
      }),
      assignedAt: null,
      firstResponseAt: null,
      resolvedAt: null,
    });

    cannedReplies.seed({
      id: "cr1",
      name: "Billing greeting",
      body: "Hi, I can help with your SEWA bill.",
      teamId: null,
      topicKey: "Billing",
      localeCode: "en",
      ordinal: 1,
      isEnabled: true,
    });

    const detail = await new GetTicketDetail({
      tickets,
      conversations,
      citizenIdentities,
      cannedReplies,
    }).execute("t1", "en");

    // Transcript: all three turns, including the one after handover — never a cold start.
    expect(detail.transcript.map((turn) => turn.id)).toEqual(["turn_1", "turn_2", "turn_3"]);

    // Identity/assurance state carried forward.
    expect(detail.identity).toEqual({
      assuranceLevel: "VerifiedPlusOtp",
      displayNameMasked: "Ahmed R.",
      verifiedByProviderKey: "uae_pass",
    });

    // Pending slot and escalation reason both present.
    expect(detail.ticket.pendingSlotName).toBe("sewa_account_number");
    expect(detail.reasonLabel).toContain("Tool call failed");

    // Topic-specific canned replies are attached too.
    expect(detail.cannedReplies).toHaveLength(1);
  });

  it("returns identity: null for an anonymous (never-verified) citizen — no cold-start crash", async () => {
    const tickets = new FakeTicketRepository();
    const conversations = new FakeConversationRepository();
    const citizenIdentities = new FakeCitizenIdentityRepository();
    const cannedReplies = new FakeCannedReplyRepository();

    conversations.seedConversation({
      id: "conv_2",
      channelKey: "WebWidget",
      localeCode: "en",
      outcome: "Escalated",
      turnCount: 1,
      startedAt: handoverAt,
      lastTurnAt: handoverAt,
      endedAt: null,
    });
    tickets.seed({
      id: "t2",
      conversationId: "conv_2",
      topic: "Library membership",
      topicKey: "Library",
      channelKey: "WebWidget",
      priority: "Normal",
      reason: "LowConfidence",
      reasonDetail: "Below threshold.",
      status: "Queued",
      routeTargetTeamId: null,
      assignedStaffUserId: null,
      queuedAt: handoverAt,
      wasRequeued: false,
      verificationState: "L0",
      citizenIdentityId: null,
      pendingSlotName: null,
      contextSnapshotJson: "{}",
      assignedAt: null,
      firstResponseAt: null,
      resolvedAt: null,
    });

    const detail = await new GetTicketDetail({
      tickets,
      conversations,
      citizenIdentities,
      cannedReplies,
    }).execute("t2", "en");
    expect(detail.identity).toBeNull();
  });

  it("throws TicketNotFoundError for an unknown ticket", async () => {
    const tickets = new FakeTicketRepository();
    const conversations = new FakeConversationRepository();
    const citizenIdentities = new FakeCitizenIdentityRepository();
    const cannedReplies = new FakeCannedReplyRepository();

    await expect(
      new GetTicketDetail({ tickets, conversations, citizenIdentities, cannedReplies }).execute(
        "missing",
        "en",
      ),
    ).rejects.toThrow(TicketNotFoundError);
  });
});
