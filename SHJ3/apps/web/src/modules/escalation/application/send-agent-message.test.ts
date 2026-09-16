import { describe, expect, it } from "vitest";
import { TicketNotAssignedToAgentError } from "../domain/ticket-lifecycle.js";
import { FakeConversationRepository, FakeTicketRepository } from "../testing/fakes.js";
import { SendAgentMessage } from "./send-agent-message.js";

const now = new Date("2026-09-10T10:05:00.000Z");

function seedAssignedTicket(tickets: FakeTicketRepository) {
  tickets.seed({
    id: "t1",
    conversationId: "conv_1",
    topic: "SEWA billing",
    topicKey: "Billing",
    channelKey: "WebWidget",
    priority: "Normal",
    reason: "UserRequest",
    reasonDetail: "detail",
    status: "Assigned",
    routeTargetTeamId: "team_1",
    assignedStaffUserId: "staff_1",
    queuedAt: now,
    wasRequeued: false,
    verificationState: "L0",
    citizenIdentityId: null,
    pendingSlotName: null,
    contextSnapshotJson: "{}",
    assignedAt: now,
    firstResponseAt: null,
    resolvedAt: null,
  });
}

describe("SendAgentMessage", () => {
  it("appends a real HumanAgent turn and flips an Assigned ticket to Active on first response", async () => {
    const tickets = new FakeTicketRepository();
    const conversations = new FakeConversationRepository();
    seedAssignedTicket(tickets);
    conversations.seedConversation({
      id: "conv_1",
      channelKey: "WebWidget",
      localeCode: "en",
      outcome: "Escalated",
      turnCount: 0,
      startedAt: now,
      lastTurnAt: now,
      endedAt: null,
    });

    const turn = await new SendAgentMessage({ tickets, conversations }).execute({
      ticketId: "t1",
      staffUserId: "staff_1",
      body: "Hi Ahmed, I can help with your SEWA bill.",
      now,
    });

    expect(turn.role).toBe("HumanAgent");
    expect(turn.contentMasked).toBe("Hi Ahmed, I can help with your SEWA bill.");

    const persistedTurns = await conversations.listTurnsAfter("conv_1", 0, 10);
    expect(persistedTurns).toHaveLength(1);

    expect((await tickets.findById("t1"))?.status).toBe("Active");
  });

  it("rejects a message from an agent who does not hold the ticket", async () => {
    const tickets = new FakeTicketRepository();
    const conversations = new FakeConversationRepository();
    seedAssignedTicket(tickets);

    await expect(
      new SendAgentMessage({ tickets, conversations }).execute({
        ticketId: "t1",
        staffUserId: "someone_else",
        body: "hi",
        now,
      }),
    ).rejects.toThrow(TicketNotAssignedToAgentError);
  });
});
