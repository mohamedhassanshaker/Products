import { describe, expect, it } from "vitest";
import { FakeAgentRepository } from "../testing/fakes.js";
import { GetAgent } from "./get-agent.js";

describe("getting one agent", () => {
  it("returns the agent with its current version", async () => {
    const agents = new FakeAgentRepository();
    const { agentId, agentVersionId } = agents.seedAgent({
      name: "Customs Enquiry Agent",
      version: { major: 2, minor: 1, status: "Published" },
    });
    const get = new GetAgent({ agents });

    const result = await get.execute({ agentId });

    expect(result?.agent.name).toBe("Customs Enquiry Agent");
    expect(result?.currentVersion.id).toBe(agentVersionId);
    expect(result?.currentVersion.label).toBe("v2.1");
  });

  it("returns null when the agent does not exist", async () => {
    const agents = new FakeAgentRepository();
    const get = new GetAgent({ agents });

    expect(await get.execute({ agentId: "agent-missing" })).toBeNull();
  });
});
