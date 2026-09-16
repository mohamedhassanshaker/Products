import { describe, expect, it } from "vitest";
import { FakePipelineRepository } from "../testing/fakes.js";
import { DeletePipelineEdge } from "./delete-pipeline-edge.js";

const NOW = new Date("2026-09-16T10:00:00.000Z");

describe("DeletePipelineEdge", () => {
  it("removes the edge", async () => {
    const pipelines = new FakePipelineRepository();
    const { pipelineVersionId } = await pipelines.createPipeline({
      name: "Billing triage",
      ownerTenantId: "tenant_1",
      createdByStaffUserId: "staff_1",
      now: NOW,
    });
    const startId = (await pipelines.getCanvas(pipelineVersionId))!.nodes[0]!.id;
    const edge = await pipelines.createEdge({
      pipelineVersionId,
      fromNodeId: startId,
      toNodeId: startId,
      kind: "LoopBack",
      ordinal: 0,
      label: null,
      maxIterations: 3,
      conditionExpression: null,
      now: NOW,
    });
    if (!edge.ok) throw new Error("setup failed");

    await new DeletePipelineEdge({ pipelines }).execute(edge.edge.id, pipelineVersionId);

    const canvas = await pipelines.getCanvas(pipelineVersionId);
    expect(canvas?.edges).toEqual([]);
  });
});
