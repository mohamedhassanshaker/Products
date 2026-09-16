import { describe, expect, it } from "vitest";
import { FakePipelineRepository, FakePublishedAgentPort } from "../testing/fakes.js";
import { UpdatePipelineNode } from "./update-pipeline-node.js";

const NOW = new Date("2026-09-16T10:00:00.000Z");

describe("UpdatePipelineNode", () => {
  it("moves a node without touching the agent registry", async () => {
    const pipelines = new FakePipelineRepository();
    const agents = new FakePublishedAgentPort();
    const { pipelineVersionId } = await pipelines.createPipeline({
      name: "Billing triage",
      ownerTenantId: "tenant_1",
      createdByStaffUserId: "staff_1",
      now: NOW,
    });
    const canvas = await pipelines.getCanvas(pipelineVersionId);
    const startNodeId = canvas!.nodes[0]!.id;

    const result = await new UpdatePipelineNode({ pipelines, agents }).execute({
      id: startNodeId,
      pipelineVersionId,
      canvasX: 250,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.node.canvasX).toBe(250);
  });

  it("rejects re-pointing a node at an unpublished agent", async () => {
    const pipelines = new FakePipelineRepository();
    const agents = new FakePublishedAgentPort();
    const { pipelineVersionId } = await pipelines.createPipeline({
      name: "Billing triage",
      ownerTenantId: "tenant_1",
      createdByStaffUserId: "staff_1",
      now: NOW,
    });
    const canvas = await pipelines.getCanvas(pipelineVersionId);
    const startNodeId = canvas!.nodes[0]!.id;

    const result = await new UpdatePipelineNode({ pipelines, agents }).execute({
      id: startNodeId,
      pipelineVersionId,
      agentId: "agt_unpublished",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "orchestration.pipeline.agent_not_published" });
  });
});
