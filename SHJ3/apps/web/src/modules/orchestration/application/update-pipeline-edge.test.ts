import { describe, expect, it } from "vitest";
import { FakePipelineRepository } from "../testing/fakes.js";
import { UpdatePipelineEdge } from "./update-pipeline-edge.js";

const NOW = new Date("2026-09-16T10:00:00.000Z");

describe("UpdatePipelineEdge", () => {
  it("updates a loop edge's own maxIterations within range", async () => {
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
    expect(edge.ok).toBe(true);
    if (!edge.ok) return;

    const result = await new UpdatePipelineEdge({ pipelines }).execute({
      id: edge.edge.id,
      pipelineVersionId,
      maxIterations: 5,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.edge.maxIterations).toBe(5);
  });

  it("rejects a maxIterations edit outside [1, 20]", async () => {
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

    const result = await new UpdatePipelineEdge({ pipelines }).execute({
      id: edge.edge.id,
      pipelineVersionId,
      maxIterations: 0,
      now: NOW,
    });

    expect(result).toEqual({
      ok: false,
      reason: "orchestration.pipeline.max_iterations_out_of_range",
    });
  });
});
