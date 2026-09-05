import { describe, expect, it } from "vitest";
import { transition, isTerminal, TERMINAL_STATUSES, IllegalToolCallTransition } from "./tool-call-fsm.js";
import type { ToolCallStatusValue } from "@nextbot/contracts";

const ALL_STATUSES: ToolCallStatusValue[] = [
  "Created", "PolicyDenied", "AwaitingCustomerConfirmation", "AwaitingHumanApproval",
  "Executing", "Succeeded", "Failed", "Cancelled", "Expired",
];

const VALID_EDGES: Array<[ToolCallStatusValue, ToolCallStatusValue]> = [
  ["Created", "PolicyDenied"],
  ["Created", "Executing"],
  ["Created", "AwaitingCustomerConfirmation"],
  ["Created", "AwaitingHumanApproval"],
  ["AwaitingCustomerConfirmation", "Executing"],
  ["AwaitingCustomerConfirmation", "Cancelled"],
  ["AwaitingCustomerConfirmation", "Expired"],
  ["AwaitingHumanApproval", "Executing"],
  ["AwaitingHumanApproval", "Cancelled"],
  ["AwaitingHumanApproval", "AwaitingHumanApproval"],
  ["AwaitingHumanApproval", "Expired"],
  ["Executing", "Succeeded"],
  ["Executing", "Failed"],
];

describe("tool-call-fsm.transition — LLD §6.1 exhaustive edge coverage", () => {
  it.each(VALID_EDGES)("allows %s -> %s", (from, to) => {
    expect(transition(from, to)).toBe(to);
  });

  it("rejects every (from, to) pair not on the LLD §6.1 diagram", () => {
    const validSet = new Set(VALID_EDGES.map(([f, t]) => `${f}->${t}`));
    let rejectedCount = 0;
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (validSet.has(`${from}->${to}`)) continue;
        expect(() => transition(from, to)).toThrow(IllegalToolCallTransition);
        rejectedCount += 1;
      }
    }
    // Sanity: this test actually exercised a meaningful number of illegal pairs,
    // not just an accidentally-empty double loop.
    expect(rejectedCount).toBeGreaterThan(50);
  });

  it("no blind retry of a terminal state — every terminal status has zero allowed successors", () => {
    for (const status of TERMINAL_STATUSES) {
      for (const to of ALL_STATUSES) {
        expect(() => transition(status, to)).toThrow(IllegalToolCallTransition);
      }
    }
  });

  it("isTerminal matches the LLD §6.1 terminal-state column exactly", () => {
    expect(new Set(TERMINAL_STATUSES)).toEqual(new Set(["PolicyDenied", "Succeeded", "Failed", "Cancelled", "Expired"]));
    for (const status of ALL_STATUSES) {
      expect(isTerminal(status)).toBe(TERMINAL_STATUSES.includes(status));
    }
  });

  it("MoreInfoRequested's self-loop keeps AwaitingHumanApproval non-terminal", () => {
    expect(transition("AwaitingHumanApproval", "AwaitingHumanApproval")).toBe("AwaitingHumanApproval");
    expect(isTerminal("AwaitingHumanApproval")).toBe(false);
  });
});
