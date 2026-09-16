import { describe, expect, it } from "vitest";
import { FakeConversationExplorerRepository, FakeGoldenCasePort } from "../testing/fakes.js";
import {
  AddConversationToGoldenSet,
  ConversationHasNoSeedError,
} from "./add-conversation-to-golden-set.js";

const now = new Date("2026-09-10T10:00:00.000Z");

function seedTranscript(explorer: FakeConversationExplorerRepository) {
  explorer.seedGoldenCaseSeed("conv_1", {
    localeCode: "en",
    promptText: "Why was my SEWA bill higher this month?",
    actualResponseText: "Your bill increased due to a seasonal tariff adjustment.",
  });
}

describe("AddConversationToGoldenSet", () => {
  it("defaults expectedBehaviour to a copy of the actual response when no override is given", async () => {
    const explorer = new FakeConversationExplorerRepository();
    seedTranscript(explorer);
    const goldenCases = new FakeGoldenCasePort();

    const result = await new AddConversationToGoldenSet({ explorer, goldenCases }).execute({
      conversationId: "conv_1",
      goldenSetId: "golden_set_1",
      mustRefuse: false,
      staffUserId: "staff_1",
      now,
    });

    expect(result.ok).toBe(true);
    expect(goldenCases.calls[0]).toMatchObject({
      prompt: "Why was my SEWA bill higher this month?",
      expectedBehaviour: "Your bill increased due to a seasonal tariff adjustment.",
      sourceConversationId: "conv_1",
      localeCode: "en",
    });
  });

  it("uses the staff-typed override when one is given", async () => {
    const explorer = new FakeConversationExplorerRepository();
    seedTranscript(explorer);
    const goldenCases = new FakeGoldenCasePort();

    await new AddConversationToGoldenSet({ explorer, goldenCases }).execute({
      conversationId: "conv_1",
      goldenSetId: "golden_set_1",
      mustRefuse: false,
      expectedBehaviourOverride: "Should also mention the SEWA hotline number.",
      staffUserId: "staff_1",
      now,
    });

    expect(goldenCases.calls[0]?.expectedBehaviour).toBe(
      "Should also mention the SEWA hotline number.",
    );
  });

  it("propagates evaluation.case_already_added unchanged for the UI to render", async () => {
    const explorer = new FakeConversationExplorerRepository();
    seedTranscript(explorer);
    const goldenCases = new FakeGoldenCasePort();
    const useCase = new AddConversationToGoldenSet({ explorer, goldenCases });
    await useCase.execute({
      conversationId: "conv_1",
      goldenSetId: "golden_set_1",
      mustRefuse: false,
      staffUserId: "staff_1",
      now,
    });

    const second = await useCase.execute({
      conversationId: "conv_1",
      goldenSetId: "golden_set_1",
      mustRefuse: false,
      staffUserId: "staff_1",
      now,
    });
    expect(second).toEqual({ ok: false, error: "evaluation.case_already_added" });
  });

  it("throws ConversationHasNoSeedError when the conversation has no seed data", async () => {
    const explorer = new FakeConversationExplorerRepository();
    const goldenCases = new FakeGoldenCasePort();
    await expect(
      new AddConversationToGoldenSet({ explorer, goldenCases }).execute({
        conversationId: "missing",
        goldenSetId: "golden_set_1",
        mustRefuse: false,
        staffUserId: "staff_1",
        now,
      }),
    ).rejects.toThrow(ConversationHasNoSeedError);
  });
});
