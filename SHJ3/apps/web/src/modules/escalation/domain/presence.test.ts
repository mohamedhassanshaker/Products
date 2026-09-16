import { describe, expect, it } from "vitest";
import { canClaimAnother, requiresDrainingHeldTickets } from "./presence.js";

describe("canClaimAnother", () => {
  it("is false while Offline regardless of capacity", () => {
    expect(
      canClaimAnother({ status: "Offline", activeTicketCount: 0, maxConcurrentTickets: 5 }),
    ).toBe(false);
  });

  it("is true when Available/Busy and under capacity", () => {
    expect(
      canClaimAnother({ status: "Available", activeTicketCount: 2, maxConcurrentTickets: 5 }),
    ).toBe(true);
    expect(canClaimAnother({ status: "Busy", activeTicketCount: 2, maxConcurrentTickets: 5 })).toBe(
      true,
    );
  });

  it("is false at exactly capacity — CK_AgentPresence_capacity", () => {
    expect(
      canClaimAnother({ status: "Available", activeTicketCount: 5, maxConcurrentTickets: 5 }),
    ).toBe(false);
  });
});

describe("requiresDrainingHeldTickets", () => {
  it("is true only when transitioning to Offline", () => {
    expect(requiresDrainingHeldTickets("Offline")).toBe(true);
    expect(requiresDrainingHeldTickets("Available")).toBe(false);
    expect(requiresDrainingHeldTickets("Busy")).toBe(false);
  });
});
