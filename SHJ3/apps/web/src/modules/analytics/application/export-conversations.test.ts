import { describe, expect, it } from "vitest";
import {
  FakeConversationExplorerRepository,
  FakeTranscriptExportRepository,
} from "../testing/fakes.js";
import { ExportConversations } from "./export-conversations.js";

const now = new Date("2026-09-10T10:00:00.000Z");

function seedConversation(
  explorer: FakeConversationExplorerRepository,
  id: string,
  outcome: string,
) {
  explorer.seedConversation({
    id,
    displayUserMasked: null,
    channelKey: "WebWidget",
    intentLabel: "Library membership",
    outcome,
    rating: null,
    lastTurnAt: now,
  });
}

describe("ExportConversations", () => {
  it("records the real row count and filter, always with redactionApplied true", async () => {
    const explorer = new FakeConversationExplorerRepository();
    seedConversation(explorer, "conv_1", "Escalated");
    seedConversation(explorer, "conv_2", "Resolved");
    const exports = new FakeTranscriptExportRepository();

    const row = await new ExportConversations({ explorer, exports }).execute({
      filter: "Escalated",
      format: "Csv",
      requestedByStaffUserId: "staff_1",
      now,
    });

    expect(row.exportedRowCount).toBe(1);
    expect(row.redactionApplied).toBe(true);
    expect(JSON.parse(row.filterJson)).toEqual({ outcome: "Escalated" });
    expect(row.expiresAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it("All exports every row the explorer view would show", async () => {
    const explorer = new FakeConversationExplorerRepository();
    seedConversation(explorer, "conv_1", "Escalated");
    seedConversation(explorer, "conv_2", "Resolved");
    const exports = new FakeTranscriptExportRepository();

    const row = await new ExportConversations({ explorer, exports }).execute({
      filter: "All",
      format: "Json",
      requestedByStaffUserId: "staff_1",
      now,
    });

    expect(row.exportedRowCount).toBe(2);
  });
});
