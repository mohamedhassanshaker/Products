import { describe, expect, it } from "vitest";
import { createGoldenSetFakes } from "../testing/fakes.js";
import { AddCaseFromTranscript } from "./add-case-from-transcript.js";

const now = new Date("2026-09-10T10:00:00.000Z");

function seedSet(sets: ReturnType<typeof createGoldenSetFakes>["sets"]) {
  sets.seed({
    id: "gs_billing",
    name: "Billing core journeys",
    ownerTenantId: "tenant_sewa",
    description: null,
    kind: "Journey",
    localeCode: null,
    caseCount: 0,
    lastScore: null,
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

describe("AddCaseFromTranscript", () => {
  it("adds a case and returns the real, trigger-maintained caseCount", async () => {
    const { sets, cases } = createGoldenSetFakes();
    seedSet(sets);
    const useCase = new AddCaseFromTranscript({ cases, sets });

    const result = await useCase.execute({
      goldenSetId: "gs_billing",
      sourceConversationId: "conv_1",
      prompt: "What is my balance?",
      expectedBehaviour: "States the balance.",
      mustRefuse: false,
      localeCode: "en",
      addedByStaffUserId: "staff_1",
      now,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.caseCount).toBe(1);
      expect(result.value.caseId).toBeTruthy();
    }
    expect((await sets.findById("gs_billing"))?.caseCount).toBe(1);
  });

  it("returns evaluation.golden_set_not_found for an unknown set", async () => {
    const { sets, cases } = createGoldenSetFakes();
    const useCase = new AddCaseFromTranscript({ cases, sets });

    const result = await useCase.execute({
      goldenSetId: "missing",
      sourceConversationId: "conv_1",
      prompt: "p",
      expectedBehaviour: "e",
      mustRefuse: false,
      localeCode: "en",
      addedByStaffUserId: "staff_1",
      now,
    });

    expect(result).toEqual({ ok: false, error: "evaluation.golden_set_not_found" });
  });

  it("returns evaluation.case_already_added on a second attempt for the same conversation, per UQ_GoldenCases_sourceConversation — and does not double-count", async () => {
    const { sets, cases } = createGoldenSetFakes();
    seedSet(sets);
    const useCase = new AddCaseFromTranscript({ cases, sets });

    const input = {
      goldenSetId: "gs_billing",
      sourceConversationId: "conv_1",
      prompt: "What is my balance?",
      expectedBehaviour: "States the balance.",
      mustRefuse: false,
      localeCode: "en",
      addedByStaffUserId: "staff_1",
      now,
    };
    const first = await useCase.execute(input);
    expect(first.ok).toBe(true);

    const second = await useCase.execute(input);
    expect(second).toEqual({ ok: false, error: "evaluation.case_already_added" });
    expect((await sets.findById("gs_billing"))?.caseCount).toBe(1);
  });
});
