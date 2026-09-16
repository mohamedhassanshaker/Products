import { describe, expect, it } from "vitest";
import { FakeAgentRepository, FakeWizardDraftRepository } from "../testing/fakes.js";
import { GetOrCreateWizardDraft } from "./get-or-create-wizard-draft.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");
const OWNER = "usr_01JBSARA";

describe("opening the wizard for an agent", () => {
  it("(a) returns an existing draft directly, without forking or creating a new one", async () => {
    const agents = new FakeAgentRepository();
    const drafts = new FakeWizardDraftRepository();
    const { agentId, agentVersionId } = agents.seedAgent({
      status: "Draft",
      version: { status: "Draft" },
    });
    drafts.seed({
      id: "draft-existing",
      agentId,
      agentVersionId,
      ownerStaffUserId: OWNER,
      lastStep: 4,
      stepStateJson: '{"tone":"Formal"}',
      updatedAt: NOW,
    });
    const useCase = new GetOrCreateWizardDraft({ agents, drafts });

    const draft = await useCase.execute({ agentId, ownerStaffUserId: OWNER, now: NOW });

    expect(draft.id).toBe("draft-existing");
    expect(draft.lastStep).toBe(4);
    expect(agents.forkOrReuseDraftVersionCalls).toHaveLength(0);
    expect(drafts.createCalls).toHaveLength(0);
  });

  it("(b) a brand-new agent (current version already Draft) creates a draft pointed at that same version", async () => {
    const agents = new FakeAgentRepository();
    const drafts = new FakeWizardDraftRepository();
    const { agentId, agentVersionId } = agents.seedAgent({
      status: "Draft",
      version: { major: 0, minor: 1, status: "Draft" },
    });
    const useCase = new GetOrCreateWizardDraft({ agents, drafts });

    const draft = await useCase.execute({ agentId, ownerStaffUserId: OWNER, now: NOW });

    expect(draft.agentVersionId).toBe(agentVersionId);
    expect(drafts.createCalls).toEqual([
      { agentId, agentVersionId, ownerStaffUserId: OWNER, now: NOW },
    ]);
    // Only one version exists on the agent — nothing was forked.
    expect(await agents.listVersions(agentId)).toHaveLength(1);
  });

  it("(c) an agent whose current version is Published gets a forked new Draft version, and the draft points at that new version", async () => {
    const agents = new FakeAgentRepository();
    const drafts = new FakeWizardDraftRepository();
    const { agentId, agentVersionId: publishedVersionId } = agents.seedAgent({
      status: "Published",
      version: { major: 1, minor: 4, status: "Published", publishedAt: NOW },
    });
    const useCase = new GetOrCreateWizardDraft({ agents, drafts });

    const draft = await useCase.execute({ agentId, ownerStaffUserId: OWNER, now: NOW });

    expect(draft.agentVersionId).not.toBe(publishedVersionId);
    const forkedVersion = await agents.getVersion(draft.agentVersionId);
    expect(forkedVersion?.status).toBe("Draft");
    expect(forkedVersion?.label).toBe("v1.5");
    expect(forkedVersion?.clonedFromVersionId).toBe(publishedVersionId);

    // The Published version is untouched and still current until this draft is published.
    const published = await agents.getVersion(publishedVersionId);
    expect(published?.status).toBe("Published");
    expect(published?.isCurrent).toBe(true);
  });

  it("(d) regression: forking after a rollback never recreates an already-existing version number", async () => {
    // Real bug found by B-3's own live-infrastructure proof: v1.0 published, forked+published
    // to v1.1, then rolled back so v1.0 is current again while v1.1 still exists (Rollback only
    // changes which version is current — it never deletes history, matching B2's own [rule]).
    // Forking from `current` (v1.0) alone would recompute v1.1, colliding with the real,
    // still-existing v1.1 row (`UQ_AgentVersions_agentId_major_minor`). The fix forks from the
    // agent's highest-ever version instead, so this must produce v1.2, not v1.1.
    const agents = new FakeAgentRepository();
    const drafts = new FakeWizardDraftRepository();
    const { agentId, agentVersionId: v10 } = agents.seedAgent({
      status: "Published",
      version: { major: 1, minor: 0, status: "Published", publishedAt: NOW },
    });
    const v11 = agents.seedVersion({
      agentId,
      major: 1,
      minor: 1,
      status: "Published",
      isCurrent: true,
      publishedAt: NOW,
    });
    const rollback = await agents.rollbackToVersion({
      agentId,
      targetVersionId: v10,
      actorStaffUserId: OWNER,
      now: NOW,
    });
    expect(rollback).toEqual({ ok: true });
    const useCase = new GetOrCreateWizardDraft({ agents, drafts });

    const draft = await useCase.execute({ agentId, ownerStaffUserId: OWNER, now: NOW });

    const forkedVersion = await agents.getVersion(draft.agentVersionId);
    expect(forkedVersion?.label).toBe("v1.2");
    expect(forkedVersion?.status).toBe("Draft");
    // Forked off the real current (v1.0, post-rollback), not off v1.1.
    expect(forkedVersion?.clonedFromVersionId).toBe(v10);
    // v1.1 itself is untouched — still Published, still exists, just no longer current.
    const stillThere = await agents.getVersion(v11);
    expect(stillThere?.status).toBe("Published");
    expect(stillThere?.isCurrent).toBe(false);
  });
});
