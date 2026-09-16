import { describe, expect, it } from "vitest";
import { FakeAgentRepository } from "../testing/fakes.js";
import { RollbackAgentVersion } from "./rollback-agent-version.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("rolling back to a prior version", () => {
  it("makes the target version current", async () => {
    const agents = new FakeAgentRepository();
    const { agentId, agentVersionId: v12 } = agents.seedAgent({
      status: "Published",
      version: { major: 1, minor: 2, status: "Published", publishedAt: NOW },
    });
    const v13 = agents.seedVersion({
      agentId,
      major: 1,
      minor: 3,
      status: "Published",
      isCurrent: true,
      publishedAt: NOW,
    });
    const rollback = new RollbackAgentVersion({ agents });

    const result = await rollback.execute({
      agentId,
      targetVersionId: v12,
      actorStaffUserId: "usr_01JBADMIN",
      now: NOW,
    });

    expect(result).toEqual({ ok: true });
    expect((await agents.getAgentDetail(agentId))?.currentVersionId).toBe(v12);
    expect((await agents.getVersion(v13))?.isCurrent).toBe(false);
    expect((await agents.getVersion(v12))?.isCurrent).toBe(true);
  });

  it("refuses to roll back to the version that is already current", async () => {
    const agents = new FakeAgentRepository();
    const { agentId, agentVersionId } = agents.seedAgent({
      status: "Published",
      version: { publishedAt: NOW },
    });
    const rollback = new RollbackAgentVersion({ agents });

    const result = await rollback.execute({
      agentId,
      targetVersionId: agentVersionId,
      actorStaffUserId: "usr_01JBADMIN",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "agent.version_is_current" });
  });
});
