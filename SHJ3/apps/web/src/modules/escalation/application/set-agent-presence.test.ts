import { describe, expect, it } from "vitest";
import { FakeAgentPresenceRepository, FakeTicketRepository } from "../testing/fakes.js";
import { SetAgentPresence } from "./set-agent-presence.js";

const queuedAt = new Date("2026-09-10T09:00:00.000Z");
const goesOfflineAt = new Date("2026-09-10T09:04:00.000Z");

describe("SetAgentPresence", () => {
  it("going Offline requeues every held ticket without punishing its wait-time clock or priority (api.md §6.8)", async () => {
    const tickets = new FakeTicketRepository();
    const presence = new FakeAgentPresenceRepository();

    tickets.seed({
      id: "t1",
      conversationId: "conv_1",
      topic: "Import declaration",
      topicKey: "Customs",
      channelKey: "WebWidget",
      priority: "High",
      reason: "UserRequest",
      reasonDetail: "Frustrated citizen requested a human.",
      status: "Active",
      routeTargetTeamId: "team_customs",
      assignedStaffUserId: "staff_1",
      queuedAt,
      wasRequeued: false,
      verificationState: "L0",
      citizenIdentityId: null,
      pendingSlotName: null,
      contextSnapshotJson: "{}",
      assignedAt: queuedAt,
      firstResponseAt: queuedAt,
      resolvedAt: null,
    });
    presence.seed({
      staffUserId: "staff_1",
      status: "Available",
      statusChangedAt: queuedAt,
      activeTicketCount: 1,
      maxConcurrentTickets: 5,
      lastHeartbeatAt: queuedAt,
    });

    const result = await new SetAgentPresence({ presence, tickets }).execute({
      staffUserId: "staff_1",
      status: "Offline",
      now: goesOfflineAt,
    });

    expect(result.status).toBe("Offline");
    expect(result.activeTicketCount).toBe(0); // CK_AgentPresence_offlineHasNoTickets

    const ticket = await tickets.findById("t1");
    expect(ticket?.status).toBe("Queued");
    expect(ticket?.assignedStaffUserId).toBeNull();
    expect(ticket?.wasRequeued).toBe(true);
    // The wait-time clock and priority are untouched by the requeue — "a ticket must
    // not be punished for an agent signing off."
    expect(ticket?.queuedAt).toEqual(queuedAt);
    expect(ticket?.priority).toBe("High");
  });

  it("switching to Busy/Available never touches held tickets", async () => {
    const tickets = new FakeTicketRepository();
    const presence = new FakeAgentPresenceRepository();
    presence.seed({
      staffUserId: "staff_1",
      status: "Offline",
      statusChangedAt: queuedAt,
      activeTicketCount: 0,
      maxConcurrentTickets: 5,
      lastHeartbeatAt: queuedAt,
    });

    const result = await new SetAgentPresence({ presence, tickets }).execute({
      staffUserId: "staff_1",
      status: "Available",
      now: goesOfflineAt,
    });

    expect(result.status).toBe("Available");
  });
});
