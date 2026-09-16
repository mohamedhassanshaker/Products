import { describe, expect, it } from "vitest";
import {
  AgentAtCapacityError,
  AgentOfflineError,
  TicketAlreadyClaimedError,
} from "../domain/ticket-lifecycle.js";
import { FakeAgentPresenceRepository, FakeTicketRepository } from "../testing/fakes.js";
import { ClaimTicket } from "./claim-ticket.js";
import { TicketNotFoundError } from "./get-ticket-detail.js";

const now = new Date("2026-09-10T10:00:00.000Z");

function seedQueuedTicket(tickets: FakeTicketRepository, id: string) {
  tickets.seed({
    id,
    conversationId: `conv_${id}`,
    topic: "SEWA billing",
    topicKey: "Billing",
    channelKey: "WebWidget",
    priority: "Normal",
    reason: "UserRequest",
    reasonDetail: "The citizen asked for a human agent.",
    status: "Queued",
    routeTargetTeamId: "team_sewa_billing",
    assignedStaffUserId: null,
    queuedAt: now,
    wasRequeued: false,
    verificationState: "L0",
    citizenIdentityId: null,
    pendingSlotName: null,
    contextSnapshotJson: "{}",
    assignedAt: null,
    firstResponseAt: null,
    resolvedAt: null,
  });
}

describe("ClaimTicket", () => {
  it("claims a Queued ticket for an Available agent under capacity", async () => {
    const tickets = new FakeTicketRepository();
    const presence = new FakeAgentPresenceRepository();
    seedQueuedTicket(tickets, "t1");
    presence.seed({
      staffUserId: "staff_1",
      status: "Available",
      statusChangedAt: now,
      activeTicketCount: 0,
      maxConcurrentTickets: 5,
      lastHeartbeatAt: now,
    });

    const claimed = await new ClaimTicket({ tickets, presence }).execute({
      ticketId: "t1",
      staffUserId: "staff_1",
      now,
    });

    expect(claimed.status).toBe("Assigned");
    expect(claimed.assignedStaffUserId).toBe("staff_1");
    expect((await presence.getOrCreate("staff_1", now)).activeTicketCount).toBe(1);
  });

  it("rejects a claim from an Offline agent — api.md §6.8 handover.agent_offline", async () => {
    const tickets = new FakeTicketRepository();
    const presence = new FakeAgentPresenceRepository();
    seedQueuedTicket(tickets, "t1");
    presence.seed({
      staffUserId: "staff_1",
      status: "Offline",
      statusChangedAt: now,
      activeTicketCount: 0,
      maxConcurrentTickets: 5,
      lastHeartbeatAt: now,
    });

    await expect(
      new ClaimTicket({ tickets, presence }).execute({
        ticketId: "t1",
        staffUserId: "staff_1",
        now,
      }),
    ).rejects.toThrow(AgentOfflineError);
  });

  it("rejects a claim once the agent is at capacity — CK_AgentPresence_capacity", async () => {
    const tickets = new FakeTicketRepository();
    const presence = new FakeAgentPresenceRepository();
    seedQueuedTicket(tickets, "t1");
    presence.seed({
      staffUserId: "staff_1",
      status: "Available",
      statusChangedAt: now,
      activeTicketCount: 5,
      maxConcurrentTickets: 5,
      lastHeartbeatAt: now,
    });

    await expect(
      new ClaimTicket({ tickets, presence }).execute({
        ticketId: "t1",
        staffUserId: "staff_1",
        now,
      }),
    ).rejects.toThrow(AgentAtCapacityError);
  });

  it("the second claimant gets ticket_already_claimed — the real race, resolved by the conditional claim", async () => {
    const tickets = new FakeTicketRepository();
    const presence = new FakeAgentPresenceRepository();
    seedQueuedTicket(tickets, "t1");
    presence.seed({
      staffUserId: "agent_a",
      status: "Available",
      statusChangedAt: now,
      activeTicketCount: 0,
      maxConcurrentTickets: 5,
      lastHeartbeatAt: now,
    });
    presence.seed({
      staffUserId: "agent_b",
      status: "Available",
      statusChangedAt: now,
      activeTicketCount: 0,
      maxConcurrentTickets: 5,
      lastHeartbeatAt: now,
    });

    const useCase = new ClaimTicket({ tickets, presence });
    await useCase.execute({ ticketId: "t1", staffUserId: "agent_a", now });

    await expect(useCase.execute({ ticketId: "t1", staffUserId: "agent_b", now })).rejects.toThrow(
      TicketAlreadyClaimedError,
    );
  });

  it("throws TicketNotFoundError for an unknown ticket id", async () => {
    const tickets = new FakeTicketRepository();
    const presence = new FakeAgentPresenceRepository();
    presence.seed({
      staffUserId: "staff_1",
      status: "Available",
      statusChangedAt: now,
      activeTicketCount: 0,
      maxConcurrentTickets: 5,
      lastHeartbeatAt: now,
    });

    await expect(
      new ClaimTicket({ tickets, presence }).execute({
        ticketId: "missing",
        staffUserId: "staff_1",
        now,
      }),
    ).rejects.toThrow(TicketNotFoundError);
  });
});
