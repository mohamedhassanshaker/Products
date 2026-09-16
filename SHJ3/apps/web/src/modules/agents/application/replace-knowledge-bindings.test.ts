import { describe, expect, it } from "vitest";
import { FakeAgentBindingsRepository } from "../testing/fakes.js";
import { ReplaceKnowledgeBindings } from "./replace-knowledge-bindings.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("replacing an agent version's knowledge bindings", () => {
  it("replaces the whole set — a binding not in the new list is removed", async () => {
    const bindings = new FakeAgentBindingsRepository();
    await bindings.replaceKnowledgeBindings(
      "agentversion-1",
      [{ knowledgeCollectionId: "kc-old", isEnabled: true }],
      "usr_01JBADMIN",
      NOW,
    );
    const replace = new ReplaceKnowledgeBindings({ bindings });

    await replace.execute({
      agentVersionId: "agentversion-1",
      bindings: [{ knowledgeCollectionId: "kc-new", isEnabled: true }],
      boundByStaffUserId: "usr_01JBADMIN",
      now: NOW,
    });

    const result = await bindings.listKnowledgeBindings("agentversion-1");
    expect(result).toEqual([{ knowledgeCollectionId: "kc-new", isEnabled: true }]);
  });
});
