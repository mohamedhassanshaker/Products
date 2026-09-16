import { describe, expect, it } from "vitest";
import { FakeConversationExplorerRepository } from "../testing/fakes.js";
import { CONVERSATION_LIST_LIMIT, ListConversations } from "./list-conversations.js";

const now = new Date("2026-09-10T10:00:00.000Z");

describe("ListConversations", () => {
  it("passes the filter and the shared list limit straight through to the repository", async () => {
    const explorer = new FakeConversationExplorerRepository();
    explorer.seedConversation({
      id: "conv_1",
      displayUserMasked: "Ahmed R.",
      channelKey: "WhatsApp",
      intentLabel: "Pay utilities bill",
      outcome: "Escalated",
      rating: "Down",
      lastTurnAt: now,
    });
    explorer.seedConversation({
      id: "conv_2",
      displayUserMasked: null,
      channelKey: "WebWidget",
      intentLabel: "Library membership",
      outcome: "Resolved",
      rating: "Up",
      lastTurnAt: now,
    });

    const escalatedOnly = await new ListConversations({ explorer }).execute("Escalated");
    expect(escalatedOnly.map((row) => row.id)).toEqual(["conv_1"]);

    const all = await new ListConversations({ explorer }).execute("All");
    expect(all).toHaveLength(2);
    expect(CONVERSATION_LIST_LIMIT).toBeGreaterThan(0);
  });
});
