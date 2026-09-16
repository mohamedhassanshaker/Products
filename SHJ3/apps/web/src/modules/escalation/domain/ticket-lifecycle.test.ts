import { describe, expect, it } from "vitest";
import {
  AgentOfflineError,
  assertClaimable,
  assertHeldByAgent,
  outcomeToStatus,
  requiresAssignedStaff,
  TicketAlreadyClaimedError,
  TicketNotAssignedToAgentError,
  TicketNotClaimableError,
} from "./ticket-lifecycle.js";

describe("requiresAssignedStaff", () => {
  it("is true only for Assigned/Active — CK_EscalationTickets_assignedPaired", () => {
    expect(requiresAssignedStaff("Assigned")).toBe(true);
    expect(requiresAssignedStaff("Active")).toBe(true);
    expect(requiresAssignedStaff("Queued")).toBe(false);
    expect(requiresAssignedStaff("Resolved")).toBe(false);
    expect(requiresAssignedStaff("Abandoned")).toBe(false);
  });
});

describe("assertClaimable", () => {
  it("allows a Queued ticket", () => {
    expect(() => assertClaimable("Queued")).not.toThrow();
  });

  it("rejects an Assigned/Active ticket as already claimed (the real race, api.md §6.8)", () => {
    expect(() => assertClaimable("Assigned")).toThrow(TicketAlreadyClaimedError);
    expect(() => assertClaimable("Active")).toThrow(TicketAlreadyClaimedError);
  });

  it("rejects a Resolved/Abandoned ticket as simply not claimable", () => {
    expect(() => assertClaimable("Resolved")).toThrow(TicketNotClaimableError);
    expect(() => assertClaimable("Abandoned")).toThrow(TicketNotClaimableError);
  });
});

describe("assertHeldByAgent", () => {
  it("allows the agent currently holding the ticket", () => {
    expect(() => assertHeldByAgent("Active", "staff_1", "staff_1")).not.toThrow();
  });

  it("rejects a different agent", () => {
    expect(() => assertHeldByAgent("Active", "staff_1", "staff_2")).toThrow(
      TicketNotAssignedToAgentError,
    );
  });

  it("rejects a ticket that is not currently held by anyone", () => {
    expect(() => assertHeldByAgent("Queued", null, "staff_1")).toThrow(
      TicketNotAssignedToAgentError,
    );
  });
});

describe("outcomeToStatus", () => {
  it("maps resolved/abandoned to their PascalCase status", () => {
    expect(outcomeToStatus("resolved")).toBe("Resolved");
    expect(outcomeToStatus("abandoned")).toBe("Abandoned");
  });
});

describe("AgentOfflineError", () => {
  it("carries the documented error code", () => {
    expect(new AgentOfflineError().message).toContain("offline");
  });
});
