import { describe, expect, it } from "vitest";
import { FakePipelineRepository, FakeRouterConfigRepository } from "../testing/fakes.js";
import { SetActivePipelineVersion } from "./set-active-pipeline-version.js";

const NOW = new Date("2026-09-16T10:00:00.000Z");

function seededRouterConfig(): FakeRouterConfigRepository {
  const routerConfig = new FakeRouterConfigRepository();
  routerConfig.seed({
    executionMode: "Sequential",
    routingStrategy: "IntentClassifier",
    agentSelectionScope: "AllPublished",
    agentScopeListJson: null,
    maxHops: 6,
    maxLoopIterations: 3,
    costCeilingTokens: 8000,
    costCeilingMicroAed: 350_000,
    conflictResolution: "HighestConfidence",
    responseMergePolicy: "DeduplicateOverlap",
    fallbackAgentId: null,
    fallbackAgentName: null,
    minRoutingConfidence: 0.3,
    updatedAt: NOW,
    activePipelineVersionId: null,
  });
  return routerConfig;
}

describe("SetActivePipelineVersion", () => {
  it("activates a Published version and records an Activated history entry", async () => {
    const pipelines = new FakePipelineRepository();
    const routerConfig = seededRouterConfig();
    const { pipelineVersionId, pipelineDesignId } = await pipelines.createPipeline({
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

    const result = await new SetActivePipelineVersion({ routerConfig, pipelines }).execute({
      pipelineVersionId,
      actorStaffUserId: "staff_2",
      now: NOW,
    });

    expect(result).toEqual({
      ok: true,
      config: expect.objectContaining({ activePipelineVersionId: pipelineVersionId }),
    });
    const history = await pipelines.listVersionHistory(pipelineDesignId);
    expect(history.some((h) => h.kind === "Activated")).toBe(true);
  });

  it("rejects activating a Draft version", async () => {
    const pipelines = new FakePipelineRepository();
    const routerConfig = seededRouterConfig();
    const { pipelineVersionId } = await pipelines.createPipeline({
      name: "Billing triage",
      ownerTenantId: "tenant_1",
      createdByStaffUserId: "staff_1",
      now: NOW,
    });

    const result = await new SetActivePipelineVersion({ routerConfig, pipelines }).execute({
      pipelineVersionId,
      actorStaffUserId: "staff_2",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "orchestration.pipeline.not_published" });
  });

  it("rejects a pipeline version id that does not exist", async () => {
    const pipelines = new FakePipelineRepository();
    const routerConfig = seededRouterConfig();

    const result = await new SetActivePipelineVersion({ routerConfig, pipelines }).execute({
      pipelineVersionId: "pv_does_not_exist",
      actorStaffUserId: "staff_2",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "orchestration.pipeline.not_found" });
  });

  it("clears the active pointer when given null, without touching history", async () => {
    const pipelines = new FakePipelineRepository();
    const routerConfig = seededRouterConfig();

    const result = await new SetActivePipelineVersion({ routerConfig, pipelines }).execute({
      pipelineVersionId: null,
      actorStaffUserId: "staff_2",
      now: NOW,
    });

    expect(result).toEqual({
      ok: true,
      config: expect.objectContaining({ activePipelineVersionId: null }),
    });
  });
});
