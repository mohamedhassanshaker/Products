import { describe, expect, it } from "vitest";
import { FakeAgentRepository } from "../testing/fakes.js";
import { UnpublishAgent } from "./unpublish-agent.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("unpublishing an agent", () => {
  it("moves a Published agent back to Draft without touching its version row", async () => {
    const agents = new FakeAgentRepository();
    const { agentId, agentVersionId } = agents.seedAgent({
      status: "Published",
      version: { major: 1, minor: 4, status: "Published", publishedAt: NOW },
    });
    const unpublish = new UnpublishAgent({ agents });

    const result = await unpublish.execute({
      agentId,
      actorStaffUserId: "usr_01JBADMIN",
      now: NOW,
    });

    expect(result).toEqual({ ok: true });
    expect((await agents.getAgentDetail(agentId))?.status).toBe("Draft");
    // The version itself stays Published — a permanent, immutable snapshot.
    expect((await agents.getVersion(agentVersionId))?.status).toBe("Published");
  });

  it("rejects an agent that is not currently Published", async () => {
    const agents = new FakeAgentRepository();
    const { agentId } = agents.seedAgent({ status: "Draft" });
    const unpublish = new UnpublishAgent({ agents });

    const result = await unpublish.execute({
      agentId,
      actorStaffUserId: "usr_01JBADMIN",
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "agent.not_published" });
  });
});
