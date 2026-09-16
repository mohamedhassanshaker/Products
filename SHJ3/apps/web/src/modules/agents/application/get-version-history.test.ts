import { describe, expect, it } from "vitest";
import { FakeAgentRepository } from "../testing/fakes.js";
import { GetVersionHistory, ListAgentVersions } from "./get-version-history.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("reading an agent's version history", () => {
  it("returns the append-only history log for the agent", async () => {
    const agents = new FakeAgentRepository();
    const { agentId, agentVersionId } = agents.seedAgent();
    agents.seedHistoryEntry({
      agentId,
      agentVersionId,
      kind: "Created",
      note: 'Created "Test Agent" as a Draft.',
      actorStaffUserId: "usr_01JBADMIN",
      occurredAt: NOW,
    });
    const getHistory = new GetVersionHistory({ agents });

    const { entries } = await getHistory.execute({ agentId });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("Created");
  });
});

describe("listing an agent's versions", () => {
  it("returns every version, newest first, each with its own change summary", async () => {
    const agents = new FakeAgentRepository();
    const { agentId } = agents.seedAgent({
      version: {
        major: 1,
        minor: 2,
        status: "Published",
        changeSummary: "Initial billing flow",
        publishedAt: NOW,
      },
    });
    agents.seedVersion({
      agentId,
      major: 1,
      minor: 3,
      status: "Published",
      isCurrent: true,
      changeSummary: "Tightened guardrail threshold",
      publishedAt: NOW,
    });
    const listVersions = new ListAgentVersions({ agents });

    const { versions } = await listVersions.execute({ agentId });
    expect(versions.map((v) => `${v.label} ${v.changeSummary}`)).toEqual([
      "v1.3 Tightened guardrail threshold",
      "v1.2 Initial billing flow",
    ]);
  });
});
