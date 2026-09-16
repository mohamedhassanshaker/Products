import { describe, expect, it } from "vitest";
import { FakeAgentBindingsRepository } from "../testing/fakes.js";
import { ReplaceFlowBindings } from "./replace-flow-bindings.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("replacing an agent version's flow bindings", () => {
  it("replaces the whole set, preserving ordinal", async () => {
    const bindings = new FakeAgentBindingsRepository();
    const replace = new ReplaceFlowBindings({ bindings });

    await replace.execute({
      agentVersionId: "agentversion-1",
      bindings: [
        { flowId: "flow-1", flowVersionId: "flowversion-1", isEnabled: true, ordinal: 0 },
        { flowId: "flow-2", flowVersionId: "flowversion-2", isEnabled: false, ordinal: 1 },
      ],
      now: NOW,
    });

    const result = await bindings.listFlowBindings("agentversion-1");
    expect(result).toHaveLength(2);
    expect(result[0]?.flowId).toBe("flow-1");
    expect(result[1]?.isEnabled).toBe(false);
  });

  it("replaces the whole set — a binding not in the new list is removed", async () => {
    const bindings = new FakeAgentBindingsRepository();
    await bindings.replaceFlowBindings(
      "agentversion-1",
      [{ flowId: "flow-old", flowVersionId: "flowversion-old", isEnabled: true, ordinal: 0 }],
      NOW,
    );
    const replace = new ReplaceFlowBindings({ bindings });

    await replace.execute({ agentVersionId: "agentversion-1", bindings: [], now: NOW });

    expect(await bindings.listFlowBindings("agentversion-1")).toEqual([]);
  });
});
