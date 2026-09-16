import { describe, expect, it } from "vitest";
import { FakePipelineRepository } from "../testing/fakes.js";
import { GetOrCreateDraftPipelineVersion } from "./get-or-create-draft-pipeline-version.js";

const NOW = new Date("2026-09-16T10:00:00.000Z");

describe("GetOrCreateDraftPipelineVersion", () => {
  it("reuses the already-Draft version unchanged", async () => {
    const pipelines = new FakePipelineRepository();
    const { pipelineDesignId, pipelineVersionId } = await pipelines.createPipeline({
      name: "Billing triage",
      ownerTenantId: "tenant_1",
      createdByStaffUserId: "staff_1",
      now: NOW,
    });

    const result = await new GetOrCreateDraftPipelineVersion({ pipelines }).execute({
      pipelineDesignId,
      actorStaffUserId: "staff_1",
      now: NOW,
    });

    expect(result.pipelineVersionId).toBe(pipelineVersionId);
  });

  it("forks a new Draft off a Published version, one minor newer", async () => {
    const pipelines = new FakePipelineRepository();
    const { pipelineDesignId, pipelineVersionId } = await pipelines.createPipeline({
      name: "Billing triage",
      ownerTenantId: "tenant_1",
      createdByStaffUserId: "staff_1",
      now: NOW,
    });
    await pipelines.publishVersion({
      pipelineVersionId,
      changeSummary: null,
      actorStaffUserId: "staff_1",
      now: NOW,
    });

    const result = await new GetOrCreateDraftPipelineVersion({ pipelines }).execute({
      pipelineDesignId,
      actorStaffUserId: "staff_1",
      now: new Date(NOW.getTime() + 1000),
    });

    expect(result.pipelineVersionId).not.toBe(pipelineVersionId);
    const forked = await pipelines.getPipelineVersion(result.pipelineVersionId);
    expect(forked?.status).toBe("Draft");
    expect(forked?.major).toBe(1);
    expect(forked?.minor).toBe(1);
    // The Start node is deep-copied, not shared, into the new Draft.
    const canvas = await pipelines.getCanvas(result.pipelineVersionId);
    expect(canvas?.nodes).toHaveLength(1);
  });

  it("reuses the SAME forked Draft on every subsequent call, never forking a second one", async () => {
    // Regression test for a real, live-reproduced bug: `PipelineDesign.currentVersionId`
    // deliberately never moves off the Published version when a Draft is forked (it only
    // moves at publish/rollback time), so a naive "is `currentVersionId`'s own version
    // Published?" check re-forks a brand-new Draft on every single call — in practice, on
    // every editor page load — silently multiplying Draft versions for the same design.
    const pipelines = new FakePipelineRepository();
    const { pipelineDesignId, pipelineVersionId } = await pipelines.createPipeline({
      name: "Billing triage",
      ownerTenantId: "tenant_1",
      createdByStaffUserId: "staff_1",
      now: NOW,
    });
    await pipelines.publishVersion({
      pipelineVersionId,
      changeSummary: null,
      actorStaffUserId: "staff_1",
      now: NOW,
    });
    const useCase = new GetOrCreateDraftPipelineVersion({ pipelines });

    const first = await useCase.execute({
      pipelineDesignId,
      actorStaffUserId: "staff_1",
      now: new Date(NOW.getTime() + 1000),
    });
    const second = await useCase.execute({
      pipelineDesignId,
      actorStaffUserId: "staff_1",
      now: new Date(NOW.getTime() + 2000),
    });
    const third = await useCase.execute({
      pipelineDesignId,
      actorStaffUserId: "staff_1",
      now: new Date(NOW.getTime() + 3000),
    });

    expect(second.pipelineVersionId).toBe(first.pipelineVersionId);
    expect(third.pipelineVersionId).toBe(first.pipelineVersionId);
  });
});
