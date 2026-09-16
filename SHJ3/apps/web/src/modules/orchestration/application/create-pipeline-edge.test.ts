import { describe, expect, it } from "vitest";
import { FakePipelineRepository } from "../testing/fakes.js";
import { CreatePipelineEdge } from "./create-pipeline-edge.js";

const NOW = new Date("2026-09-16T10:00:00.000Z");

async function seedTwoNodes(pipelines: FakePipelineRepository) {
  const { pipelineVersionId } = await pipelines.createPipeline({
    name: "Billing triage",
    ownerTenantId: "tenant_1",
    createdByStaffUserId: "staff_1",
    now: NOW,
  });
  const startId = (await pipelines.getCanvas(pipelineVersionId))!.nodes[0]!.id;
  const response = await pipelines.createNode({
    pipelineVersionId,
    kind: "Response",
    title: "Response",
    canvasX: 200,
    canvasY: 0,
    agentId: null,
    usesTurnBoundAgent: false,
    agentVersionPinId: null,
    inputContextMode: "UserTurnOnly",
    isOwningEntity: true,
    onErrorPolicy: "FailTurn",
    now: NOW,
  });
  return { pipelineVersionId, startId, responseId: response.id };
}

describe("CreatePipelineEdge", () => {
  it("creates a plain Sequential edge", async () => {
    const pipelines = new FakePipelineRepository();
    const { pipelineVersionId, startId, responseId } = await seedTwoNodes(pipelines);

    const result = await new CreatePipelineEdge({ pipelines }).execute({
      pipelineVersionId,
      fromNodeId: startId,
      toNodeId: responseId,
      kind: "Sequential",
      ordinal: 0,
      label: null,
      maxIterations: null,
      conditionExpression: null,
      now: NOW,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a LoopBack edge with no maxIterations", async () => {
    const pipelines = new FakePipelineRepository();
    const { pipelineVersionId, startId, responseId } = await seedTwoNodes(pipelines);

    const result = await new CreatePipelineEdge({ pipelines }).execute({
      pipelineVersionId,
      fromNodeId: responseId,
      toNodeId: startId,
      kind: "LoopBack",
      ordinal: 0,
      label: null,
      maxIterations: null,
      conditionExpression: null,
      now: NOW,
    });

    expect(result).toEqual({
      ok: false,
      reason: "orchestration.pipeline.loop_edge_requires_max_iterations",
    });
  });

  it("rejects a LoopBack edge with maxIterations out of range", async () => {
    const pipelines = new FakePipelineRepository();
    const { pipelineVersionId, startId, responseId } = await seedTwoNodes(pipelines);

    const result = await new CreatePipelineEdge({ pipelines }).execute({
      pipelineVersionId,
      fromNodeId: responseId,
      toNodeId: startId,
      kind: "LoopBack",
      ordinal: 0,
      label: null,
      maxIterations: 21,
      conditionExpression: null,
      now: NOW,
    });

    expect(result).toEqual({
      ok: false,
      reason: "orchestration.pipeline.max_iterations_out_of_range",
    });
  });

  it("rejects a condition expression on a non-loop edge", async () => {
    const pipelines = new FakePipelineRepository();
    const { pipelineVersionId, startId, responseId } = await seedTwoNodes(pipelines);

    const result = await new CreatePipelineEdge({ pipelines }).execute({
      pipelineVersionId,
      fromNodeId: startId,
      toNodeId: responseId,
      kind: "Sequential",
      ordinal: 0,
      label: null,
      maxIterations: null,
      conditionExpression: "iteration < 3",
      now: NOW,
    });

    expect(result).toEqual({
      ok: false,
      reason: "orchestration.pipeline.condition_on_non_loop_edge",
    });
  });

  it("rejects an edge whose endpoint belongs to a different version", async () => {
    const pipelines = new FakePipelineRepository();
    const { pipelineVersionId, startId } = await seedTwoNodes(pipelines);

    const result = await new CreatePipelineEdge({ pipelines }).execute({
      pipelineVersionId,
      fromNodeId: startId,
      toNodeId: "node_from_a_different_version",
      kind: "Sequential",
      ordinal: 0,
      label: null,
      maxIterations: null,
      conditionExpression: null,
      now: NOW,
    });

    expect(result).toEqual({
      ok: false,
      reason: "orchestration.pipeline.endpoint_wrong_version",
    });
  });

  it("rejects a second Sequential edge out of the same node (non-homogeneous fan-out)", async () => {
    const pipelines = new FakePipelineRepository();
    const { pipelineVersionId, startId, responseId } = await seedTwoNodes(pipelines);
    const second = await pipelines.createNode({
      pipelineVersionId,
      kind: "Agent",
      title: "Second",
      canvasX: 300,
      canvasY: 0,
      agentId: null,
      usesTurnBoundAgent: true,
      agentVersionPinId: null,
      inputContextMode: "UserTurnOnly",
      isOwningEntity: true,
      onErrorPolicy: "FailTurn",
      now: NOW,
    });
    await new CreatePipelineEdge({ pipelines }).execute({
      pipelineVersionId,
      fromNodeId: startId,
      toNodeId: responseId,
      kind: "Sequential",
      ordinal: 0,
      label: null,
      maxIterations: null,
      conditionExpression: null,
      now: NOW,
    });

    const result = await new CreatePipelineEdge({ pipelines }).execute({
      pipelineVersionId,
      fromNodeId: startId,
      toNodeId: second.id,
      kind: "Sequential",
      ordinal: 1,
      label: null,
      maxIterations: null,
      conditionExpression: null,
      now: NOW,
    });

    expect(result).toEqual({
      ok: false,
      reason: "orchestration.pipeline.non_homogeneous_fan_out",
    });
  });
});
