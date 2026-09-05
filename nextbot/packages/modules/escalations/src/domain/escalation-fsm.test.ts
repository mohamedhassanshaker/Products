import { describe, expect, it } from "vitest";
import {
  assertValidEscalationTransition,
  isTerminalEscalationStatus,
  IllegalEscalationTransition,
  TERMINAL_ESCALATION_STATUSES,
  type EscalationStatusValue,
} from "./escalation-fsm.js";

const ALL_STATUSES: EscalationStatusValue[] = ["Waiting", "InProgress", "Resolved", "ReturnedToBot"];

const VALID_EDGES: Array<[EscalationStatusValue, EscalationStatusValue]> = [
  ["Waiting", "InProgress"],
  ["InProgress", "InProgress"],
  ["InProgress", "Resolved"],
  ["InProgress", "ReturnedToBot"],
];

describe("escalation-fsm (LLD §3.9)", () => {
  it("accepts every valid edge", () => {
    for (const [from, to] of VALID_EDGES) {
      expect(() => assertValidEscalationTransition(from, to)).not.toThrow();
    }
  });

  it("rejects every non-edge across the full 4x4 status matrix", () => {
    const validSet = new Set(VALID_EDGES.map(([f, t]) => `${f}->${t}`));
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const key = `${from}->${to}`;
        if (validSet.has(key)) continue;
        expect(() => assertValidEscalationTransition(from, to), key).toThrow(IllegalEscalationTransition);
      }
    }
  });

  it("terminal statuses have no successors", () => {
    for (const terminal of TERMINAL_ESCALATION_STATUSES) {
      for (const to of ALL_STATUSES) {
        expect(() => assertValidEscalationTransition(terminal, to)).toThrow();
      }
    }
  });

  it("isTerminalEscalationStatus classifies correctly", () => {
    expect(isTerminalEscalationStatus("Resolved")).toBe(true);
    expect(isTerminalEscalationStatus("ReturnedToBot")).toBe(true);
    expect(isTerminalEscalationStatus("Waiting")).toBe(false);
    expect(isTerminalEscalationStatus("InProgress")).toBe(false);
  });
});
