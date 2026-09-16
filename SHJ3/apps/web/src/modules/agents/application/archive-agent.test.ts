import { describe, expect, it } from "vitest";
import { FakeAgentRepository } from "../testing/fakes.js";
import { ArchiveAgent } from "./archive-agent.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("archiving an agent", () => {
  it("archives an agent that is not bound to a live channel", async () => {
    const agents = new FakeAgentRepository();
    const { agentId } = agents.seedAgent({ status: "Published" });
    const archive = new ArchiveAgent({ agents });

    const result = await archive.execute({ agentId, actorStaffUserId: "usr_01JBADMIN", now: NOW });

    expect(result).toEqual({ ok: true });
    expect((await agents.getAgentDetail(agentId))?.status).toBe("Archived");
  });

  it("refuses to archive an agent bound to a live channel", async () => {
    const agents = new FakeAgentRepository();
    const { agentId } = agents.seedAgent({ status: "Published" });
    agents.setBoundToLiveChannel(agentId, true);
    const archive = new ArchiveAgent({ agents });

    const result = await archive.execute({ agentId, actorStaffUserId: "usr_01JBADMIN", now: NOW });

    expect(result).toEqual({ ok: false, reason: "agent.bound_to_live_channel" });
    expect((await agents.getAgentDetail(agentId))?.status).toBe("Published");
  });
});
