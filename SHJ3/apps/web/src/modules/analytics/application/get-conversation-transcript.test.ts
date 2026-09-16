import { describe, expect, it } from "vitest";
import { FakeConversationExplorerRepository } from "../testing/fakes.js";
import {
  ConversationNotFoundError,
  GetConversationTranscript,
} from "./get-conversation-transcript.js";

describe("GetConversationTranscript", () => {
  it("returns the transcript for a real conversation", async () => {
    const explorer = new FakeConversationExplorerRepository();
    explorer.seedConversation({
      id: "conv_1",
      displayUserMasked: "Ahmed R.",
      channelKey: "WhatsApp",
      intentLabel: "Pay utilities bill",
      outcome: "Escalated",
      rating: "Down",
      lastTurnAt: new Date("2026-09-10T10:00:00.000Z"),
    });
    explorer.seedTranscript("conv_1", [
      {
        id: "turn_1",
        role: "Citizen",
        contentMasked: "Why was my SEWA bill higher this month?",
        contentFormat: "Text",
        createdAt: new Date("2026-09-10T09:59:00.000Z"),
        rating: null,
      },
    ]);

    const transcript = await new GetConversationTranscript({ explorer }).execute("conv_1");
    expect(transcript).toHaveLength(1);
    expect(transcript[0]?.contentMasked).toBe("Why was my SEWA bill higher this month?");
  });

  it("throws ConversationNotFoundError for an unknown id", async () => {
    const explorer = new FakeConversationExplorerRepository();
    await expect(new GetConversationTranscript({ explorer }).execute("missing")).rejects.toThrow(
      ConversationNotFoundError,
    );
  });
});
