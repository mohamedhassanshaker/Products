import { describe, expect, it } from "vitest";
import { FakeAgentRepository } from "../testing/fakes.js";
import { CloneAgent } from "./clone-agent.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("cloning an agent", () => {
  it("creates a new v0.1 Draft agent, distinct from the source", async () => {
    const agents = new FakeAgentRepository();
    const { agentId: sourceAgentId } = agents.seedAgent({
      name: "SEWA & Utilities Billing Agent",
      version: {
        major: 1,
        minor: 4,
        status: "Published",
        publishedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
    const clone = new CloneAgent({ agents });

    const result = await clone.execute({
      sourceAgentId,
      actorStaffUserId: "usr_01JBADMIN",
      now: NOW,
    });

    expect(result.agentId).not.toBe(sourceAgentId);
    expect(result.sourceLabel).toBe("v1.4");

    const clonedDetail = await agents.getAgentDetail(result.agentId);
    expect(clonedDetail?.name).toBe("SEWA & Utilities Billing Agent (copy)");
    expect(clonedDetail?.clonedFromAgentId).toBe(sourceAgentId);

    const clonedVersion = await agents.getVersion(result.agentVersionId);
    expect(clonedVersion?.label).toBe("v0.1");
    expect(clonedVersion?.status).toBe("Draft");
  });

  it("delegates directly to the repository", async () => {
    const agents = new FakeAgentRepository();
    const { agentId } = agents.seedAgent();
    const clone = new CloneAgent({ agents });

    const input = { sourceAgentId: agentId, actorStaffUserId: "usr_01JBADMIN", now: NOW };
    await clone.execute(input);

    expect(agents.cloneAgentCalls).toEqual([input]);
  });

  it("throws for a source agent that does not exist", async () => {
    const agents = new FakeAgentRepository();
    const clone = new CloneAgent({ agents });

    await expect(
      clone.execute({
        sourceAgentId: "agent-missing",
        actorStaffUserId: "usr_01JBADMIN",
        now: NOW,
      }),
    ).rejects.toThrow(/no such agent/i);
  });
});
