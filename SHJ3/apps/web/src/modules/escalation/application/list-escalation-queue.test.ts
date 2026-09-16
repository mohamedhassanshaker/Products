import { describe, expect, it } from "vitest";
import {
  FakeHandoverRoutingConfigRepository,
  FakeRoutingRuleRepository,
  FakeTicketRepository,
} from "../testing/fakes.js";
import { ListEscalationQueue } from "./list-escalation-queue.js";

const now = new Date("2026-09-10T12:00:00.000Z");
const queuedAt = new Date("2026-09-10T11:58:00.000Z");

function freshTicket(overrides: Partial<Parameters<FakeTicketRepository["seed"]>[0]>) {
  return {
    id: "t1",
    conversationId: "conv_1",
    topic: "SEWA billing",
    topicKey: "Billing",
    channelKey: "WebWidget",
    priority: "High",
    reason: "UserRequest",
    reasonDetail: "detail",
    status: "Queued" as const,
    routeTargetTeamId: null,
    assignedStaffUserId: null,
    queuedAt,
    wasRequeued: false,
    verificationState: "L0",
    citizenIdentityId: null,
    pendingSlotName: null,
    contextSnapshotJson: "{}",
    assignedAt: null,
    firstResponseAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

describe("ListEscalationQueue — lazy routing, first active match wins", () => {
  it("routes a newly-queued Billing+High ticket to the SEWA billing team, matching Topic before Priority", async () => {
    const tickets = new FakeTicketRepository();
    const rules = new FakeRoutingRuleRepository();
    const handoverConfig = new FakeHandoverRoutingConfigRepository();
    handoverConfig.seed({
      defaultQueueTeamId: "team_default",
      maxWaitSecondsBeforeRequeue: 600,
      supervisorAlertTeamId: null,
    });

    tickets.seed(freshTicket({ id: "t1" }));
    rules.seed({
      id: "r1",
      ordinal: 1,
      attribute: "Topic",
      operator: "Eq",
      value: "Billing",
      targetKind: "Team",
      targetTeamId: "team_sewa_billing",
      alertSupervisor: false,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    });
    rules.seed({
      id: "r2",
      ordinal: 2,
      attribute: "Priority",
      operator: "Eq",
      value: "High",
      targetKind: "Team",
      targetTeamId: "team_senior_agents",
      alertSupervisor: false,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    });

    const queue = await new ListEscalationQueue({ tickets, rules, handoverConfig }).execute(now);

    expect(queue).toHaveLength(1);
    expect(queue[0]?.routeTargetTeamId).toBe("team_sewa_billing");

    // The routing decision is persisted, not recomputed on every read.
    const persisted = await tickets.findById("t1");
    expect(persisted?.routeTargetTeamId).toBe("team_sewa_billing");
  });

  it("falls to the default queue team when no enabled rule matches", async () => {
    const tickets = new FakeTicketRepository();
    const rules = new FakeRoutingRuleRepository();
    const handoverConfig = new FakeHandoverRoutingConfigRepository();
    handoverConfig.seed({
      defaultQueueTeamId: "team_default",
      maxWaitSecondsBeforeRequeue: 600,
      supervisorAlertTeamId: null,
    });
    tickets.seed(freshTicket({ id: "t2", topicKey: "Library", priority: "Normal" }));

    const queue = await new ListEscalationQueue({ tickets, rules, handoverConfig }).execute(now);
    expect(queue[0]?.routeTargetTeamId).toBe("team_default");
  });

  it("sorts High priority ahead of Normal, oldest-first within the same priority", async () => {
    const tickets = new FakeTicketRepository();
    const rules = new FakeRoutingRuleRepository();
    const handoverConfig = new FakeHandoverRoutingConfigRepository();
    handoverConfig.seed({
      defaultQueueTeamId: "team_default",
      maxWaitSecondsBeforeRequeue: 600,
      supervisorAlertTeamId: null,
    });

    tickets.seed(
      freshTicket({
        id: "normal_older",
        priority: "Normal",
        queuedAt: new Date("2026-09-10T11:50:00.000Z"),
        routeTargetTeamId: "x",
      }),
    );
    tickets.seed(
      freshTicket({
        id: "high_newer",
        priority: "High",
        queuedAt: new Date("2026-09-10T11:59:00.000Z"),
        routeTargetTeamId: "x",
      }),
    );

    const queue = await new ListEscalationQueue({ tickets, rules, handoverConfig }).execute(now);
    expect(queue.map((t) => t.id)).toEqual(["high_newer", "normal_older"]);
  });

  it("does not re-route an already-routed ticket", async () => {
    const tickets = new FakeTicketRepository();
    const rules = new FakeRoutingRuleRepository();
    const handoverConfig = new FakeHandoverRoutingConfigRepository();
    tickets.seed(freshTicket({ id: "t3", routeTargetTeamId: "team_already_set" }));
    rules.seed({
      id: "r1",
      ordinal: 1,
      attribute: "Topic",
      operator: "Eq",
      value: "Billing",
      targetKind: "Team",
      targetTeamId: "team_sewa_billing",
      alertSupervisor: false,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    });

    const queue = await new ListEscalationQueue({ tickets, rules, handoverConfig }).execute(now);
    expect(queue[0]?.routeTargetTeamId).toBe("team_already_set");
  });
});
