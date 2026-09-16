import { describe, expect, it } from "vitest";
import { FakePipelineRepository } from "../testing/fakes.js";
import { SetPipelineEntryNode } from "./set-pipeline-entry-node.js";

const NOW = new Date("2026-09-16T10:00:00.000Z");

describe("SetPipelineEntryNode", () => {
  it("updates the version's entryNodeId", async () => {
    const pipelines = new FakePipelineRepository();
    const { pipelineVersionId } = await pipelines.createPipeline({
      name: "Billing triage",
      ownerTenantId: "tenant_1",
      createdByStaffUserId: "staff_1",
      now: NOW,
    });
    const other = await pipelines.createNode({
      pipelineVersionId,
      kind: "Start",
      title: "Alt start",
      canvasX: 0,
      canvasY: 200,
      agentId: null,
      usesTurnBoundAgent: false,
      agentVersionPinId: null,
      inputContextMode: "UserTurnOnly",
      isOwningEntity: false,
      onErrorPolicy: "FailTurn",
      now: NOW,
    });

    await new SetPipelineEntryNode({ pipelines }).execute(pipelineVersionId, other.id, NOW);

    const version = await pipelines.getPipelineVersion(pipelineVersionId);
    expect(version?.entryNodeId).toBe(other.id);
  });
});
