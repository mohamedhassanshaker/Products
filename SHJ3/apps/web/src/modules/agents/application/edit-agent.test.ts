import { describe, expect, it } from "vitest";
import { FakeAgentRepository } from "../testing/fakes.js";
import { EditAgent } from "./edit-agent.js";

describe("editing an agent", () => {
  it("updates only the fields given", async () => {
    const agents = new FakeAgentRepository();
    const { agentId } = agents.seedAgent({ name: "Old Name", description: "Old description" });
    const edit = new EditAgent({ agents });

    await edit.execute({ agentId, name: "New Name" });

    const detail = await agents.getAgentDetail(agentId);
    expect(detail?.name).toBe("New Name");
    expect(detail?.description).toBe("Old description");
  });

  it("clears the description when explicitly given null", async () => {
    const agents = new FakeAgentRepository();
    const { agentId } = agents.seedAgent({ description: "Old description" });
    const edit = new EditAgent({ agents });

    await edit.execute({ agentId, description: null });

    expect((await agents.getAgentDetail(agentId))?.description).toBeNull();
  });

  it("does not pass a name/description key at all when neither is given", async () => {
    const agents = new FakeAgentRepository();
    const { agentId } = agents.seedAgent({ name: "Unchanged" });
    const edit = new EditAgent({ agents });

    await edit.execute({ agentId });

    expect(agents.editAgentCalls).toEqual([{ agentId }]);
  });
});
