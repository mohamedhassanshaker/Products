import { describe, expect, it } from "vitest";
import { FakePipelineRepository } from "../testing/fakes.js";
import { RollbackPipelineVersion } from "./rollback-pipeline-version.js";

const NOW = new Date("2026-09-16T10:00:00.000Z");

describe("RollbackPipelineVersion", () => {
  it("makes a previously-Published version current again", async () => {
    const pipelines = new FakePipelineRepository();
    const { pipelineDesignId, pipelineVersionId: v1 } = await pipelines.createPipeline({
      name: "Billing triage",
      ownerTenantId: "tenant_1",
      createdByStaffUserId: "staff_1",
      now: NOW,
    });
    await pipelines.publishVersion({
      pipelineVersionId: v1,
      changeSummary: null,
      actorStaffUserId: "staff_1",
      now: NOW,
    });
    const { pipelineVersionId: v2 } = await pipelines.forkOrReuseDraftVersion({
      pipelineDesignId,
      actorStaffUserId: "staff_1",
      now: new Date(NOW.getTime() + 1000),
    });
    await pipelines.publishVersion({
      pipelineVersionId: v2,
      changeSummary: null,
      actorStaffUserId: "staff_1",
      now: new Date(NOW.getTime() + 2000),
    });

    const result = await new RollbackPipelineVersion({ pipelines }).execute({
      pipelineDesignId,
      targetVersionId: v1,
      actorStaffUserId: "staff_2",
      now: new Date(NOW.getTime() + 3000),
    });

    expect(result).toEqual({ ok: true });
    expect((await pipelines.getPipelineVersion(v1))?.isCurrent).toBe(true);
    expect((await pipelines.getPipelineVersion(v2))?.isCurrent).toBe(false);
  });

  it("rejects rolling back to the version that is already current", async () => {
    const pipelines = new FakePipelineRepository();
    const { pipelineDesignId, pipelineVersionId } = await pipelines.createPipeline({
      name: "Billing triage",
      ownerTenantId: "tenant_1",
      createdByStaffUserId: "staff_1",
      now: NOW,
    });

    const result = await new RollbackPipelineVersion({ pipelines }).execute({
      pipelineDesignId,
      targetVersionId: pipelineVersionId,
      actorStaffUserId: "staff_2",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "orchestration.pipeline.version_is_current" });
  });
});
