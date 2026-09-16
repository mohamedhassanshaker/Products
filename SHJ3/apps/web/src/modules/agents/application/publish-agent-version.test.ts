import { describe, expect, it } from "vitest";
import { FakeAgentRepository, FakeWizardDraftRepository } from "../testing/fakes.js";
import type { PublishGateChecker, PublishGateDecision } from "../ports/publish-gate-checker.js";
import { PublishAgentVersion } from "./publish-agent-version.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("publishing an agent version", () => {
  it("publishes a Draft version and deletes the agent's wizard draft", async () => {
    const agents = new FakeAgentRepository();
    const drafts = new FakeWizardDraftRepository();
    const { agentId, agentVersionId } = agents.seedAgent({
      status: "Draft",
      version: { major: 0, minor: 1, status: "Draft" },
    });
    drafts.seed({
      id: "draft-1",
      agentId,
      agentVersionId,
      ownerStaffUserId: "usr_01JBSARA",
      lastStep: 10,
      stepStateJson: "{}",
      updatedAt: NOW,
    });
    const publish = new PublishAgentVersion({ agents, drafts });

    const result = await publish.execute({
      agentVersionId,
      agentId,
      changeSummary: "Initial billing flow",
      actorStaffUserId: "usr_01JBADMIN",
      now: NOW,
    });

    expect(result).toEqual({ ok: true, label: "v1.0" });
    expect(await drafts.findByOwnerAndAgent("usr_01JBSARA", agentId)).toBeNull();
    expect(drafts.deleteForAgentCalls).toEqual([agentId]);
  });

  it("rejects an already-Published version without calling publishVersion or deleting the draft", async () => {
    const agents = new FakeAgentRepository();
    const drafts = new FakeWizardDraftRepository();
    const { agentId, agentVersionId } = agents.seedAgent({
      status: "Published",
      version: { major: 1, minor: 0, status: "Published", publishedAt: NOW },
    });
    drafts.seed({
      id: "draft-1",
      agentId,
      agentVersionId,
      ownerStaffUserId: "usr_01JBSARA",
      lastStep: 10,
      stepStateJson: "{}",
      updatedAt: NOW,
    });
    const publish = new PublishAgentVersion({ agents, drafts });

    const result = await publish.execute({
      agentVersionId,
      agentId,
      changeSummary: null,
      actorStaffUserId: "usr_01JBADMIN",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "agent.already_published" });
    // Defense in depth: the use case's own `canPublish` guard caught this before the
    // repository's identical, redundant check ever ran.
    expect(agents.publishVersionCalls).toHaveLength(0);
    expect(drafts.deleteForAgentCalls).toHaveLength(0);
  });

  it("FR-AGENT-20: a supplied gate blocking the publish prevents publishVersion/deleteForAgent, and names the agent/version/reasons", async () => {
    const agents = new FakeAgentRepository();
    const drafts = new FakeWizardDraftRepository();
    const { agentId, agentVersionId } = agents.seedAgent({
      status: "Draft",
      version: { major: 3, minor: 0, status: "Draft" },
    });
    const blockedReasons: PublishGateDecision = {
      passed: false,
      reasons: [
        {
          metric: "accuracy",
          goldenSetId: "gs_arabic",
          goldenSetName: "Arabic language parity",
          observed: 0.71,
          threshold: 0.85,
        },
      ],
    };
    const gate: PublishGateChecker = { evaluateForPublish: async () => blockedReasons };
    const publish = new PublishAgentVersion({ agents, drafts, gate });

    const result = await publish.execute({
      agentVersionId,
      agentId,
      changeSummary: null,
      actorStaffUserId: "usr_01JBADMIN",
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "gate_blocked") {
      expect(result.versionLabel).toBe("v3.0");
      expect(result.reasons).toEqual(blockedReasons.passed ? [] : blockedReasons.reasons);
    } else {
      throw new Error("expected a gate_blocked rejection");
    }
    expect(agents.publishVersionCalls).toHaveLength(0);
    expect(drafts.deleteForAgentCalls).toHaveLength(0);
  });

  it("a supplied gate that passes lets the publish proceed normally", async () => {
    const agents = new FakeAgentRepository();
    const drafts = new FakeWizardDraftRepository();
    const { agentId, agentVersionId } = agents.seedAgent({
      status: "Draft",
      version: { major: 0, minor: 1, status: "Draft" },
    });
    const gate: PublishGateChecker = { evaluateForPublish: async () => ({ passed: true }) };
    const publish = new PublishAgentVersion({ agents, drafts, gate });

    const result = await publish.execute({
      agentVersionId,
      agentId,
      changeSummary: null,
      actorStaffUserId: "usr_01JBADMIN",
      now: NOW,
    });

    expect(result).toEqual({ ok: true, label: "v1.0" });
  });

  it("throws for a version id that does not exist", async () => {
    const agents = new FakeAgentRepository();
    const drafts = new FakeWizardDraftRepository();
    const publish = new PublishAgentVersion({ agents, drafts });

    await expect(
      publish.execute({
        agentVersionId: "agentversion-missing",
        agentId: "agent-missing",
        changeSummary: null,
        actorStaffUserId: "usr_01JBADMIN",
        now: NOW,
      }),
    ).rejects.toThrow(/no such version/i);
  });
});
