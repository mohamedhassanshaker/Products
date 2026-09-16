import { describe, expect, it } from "vitest";
import { FakeWizardDraftRepository } from "../testing/fakes.js";
import { SaveWizardDraftStep } from "./save-wizard-draft-step.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("saving a wizard draft step", () => {
  it("replaces lastStep and stepStateJson on the draft", async () => {
    const drafts = new FakeWizardDraftRepository();
    drafts.seed({
      id: "draft-1",
      agentId: "agent-1",
      agentVersionId: "agentversion-1",
      ownerStaffUserId: "usr_01JBSARA",
      lastStep: 1,
      stepStateJson: "{}",
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    const save = new SaveWizardDraftStep({ drafts });

    await save.execute({
      draftId: "draft-1",
      lastStep: 3,
      stepStateJson: '{"tone":"Formal"}',
      now: NOW,
    });

    const draft = await drafts.findByOwnerAndAgent("usr_01JBSARA", "agent-1");
    expect(draft?.lastStep).toBe(3);
    expect(draft?.stepStateJson).toBe('{"tone":"Formal"}');
    expect(draft?.updatedAt).toEqual(NOW);
  });

  it("is a full replace: an earlier step's state is gone once a later step's full payload is saved over it", async () => {
    const drafts = new FakeWizardDraftRepository();
    drafts.seed({
      id: "draft-1",
      agentId: "agent-1",
      agentVersionId: "agentversion-1",
      ownerStaffUserId: "usr_01JBSARA",
      lastStep: 1,
      stepStateJson: '{"identity":{"name":"Draft"}}',
      updatedAt: NOW,
    });
    const save = new SaveWizardDraftStep({ drafts });

    await save.execute({
      draftId: "draft-1",
      lastStep: 2,
      stepStateJson: '{"instructions":{}}',
      now: NOW,
    });

    const draft = await drafts.findByOwnerAndAgent("usr_01JBSARA", "agent-1");
    expect(draft?.stepStateJson).toBe('{"instructions":{}}');
  });

  it("throws for a draft id that does not exist", async () => {
    const drafts = new FakeWizardDraftRepository();
    const save = new SaveWizardDraftStep({ drafts });

    await expect(
      save.execute({ draftId: "draft-missing", lastStep: 1, stepStateJson: "{}", now: NOW }),
    ).rejects.toThrow(/no such wizard draft/i);
  });
});
