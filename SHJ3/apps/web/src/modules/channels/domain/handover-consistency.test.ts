import { describe, expect, it } from "vitest";
import { checkHandoverConsistency } from "./handover-consistency.js";

describe("checkHandoverConsistency", () => {
  it("rejects offering escalation outside hours when the assistant itself refuses sessions outside hours", () => {
    const result = checkHandoverConsistency({
      assistantAvailable247: false,
      offerEscalationOutsideHours: true,
    });
    expect(result).toEqual({
      ok: false,
      reason: "channels.handover_requires_assistant_available",
    });
  });

  it("allows the wireframe's own documented shape: assistant 24/7, message replaces the offer", () => {
    expect(
      checkHandoverConsistency({
        assistantAvailable247: true,
        offerEscalationOutsideHours: false,
      }),
    ).toEqual({ ok: true });
  });

  it("allows assistant-247 with escalation still offered (e.g. an overflow queue) — a legitimate choice", () => {
    expect(
      checkHandoverConsistency({
        assistantAvailable247: true,
        offerEscalationOutsideHours: true,
      }),
    ).toEqual({ ok: true });
  });

  it("allows sessions refused outside hours with no escalation offer either — consistent", () => {
    expect(
      checkHandoverConsistency({
        assistantAvailable247: false,
        offerEscalationOutsideHours: false,
      }),
    ).toEqual({ ok: true });
  });
});
