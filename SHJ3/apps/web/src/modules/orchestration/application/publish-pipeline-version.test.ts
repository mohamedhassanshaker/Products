import { describe, expect, it } from "vitest";
import { FakePipelineRepository, FakePublishedAgentPort } from "../testing/fakes.js";
import { PublishPipelineVersion } from "./publish-pipeline-version.js";

const NOW = new Date("2026-09-16T10:00:00.000Z");

async function seedValidLinearPipeline(pipelines: FakePipelineRepository, agents: FakePublishedAgentPort) {
  const { pipelineVersionId } = await pipelines.createPipeline({
    name: "Billing triage",
    ownerTenantId: "tenant_1",
    createdByStaffUserId: "staff_1",
    now: NOW,
  });
  const startId = (await pipelines.getCanvas(pipelineVersionId))!.nodes[0]!.id;
  const agentNode = await pipelines.createNode({
    pipelineVersionId,
    kind: "Agent",
    title: "Triage",
    canvasX: 150,
    canvasY: 0,
    agentId: "agt_billing",
    usesTurnBoundAgent: false,
    agentVersionPinId: null,
    inputContextMode: "UserTurnOnly",
    isOwningEntity: true,
    onErrorPolicy: "FailTurn",
    now: NOW,
  });
  const responseNode = await pipelines.createNode({
    pipelineVersionId,
    kind: "Response",
    title: "Response",
    canvasX: 300,
    canvasY: 0,
    agentId: null,
    usesTurnBoundAgent: false,
    agentVersionPinId: null,
    inputContextMode: "UserTurnOnly",
    isOwningEntity: true,
    onErrorPolicy: "FailTurn",
    now: NOW,
  });
  await pipelines.createEdge({
    pipelineVersionId,
    fromNodeId: startId,
    toNodeId: agentNode.id,
    kind: "Sequential",
    ordinal: 0,
    label: null,
    maxIterations: null,
    conditionExpression: null,
    now: NOW,
  });
  await pipelines.createEdge({
    pipelineVersionId,
    fromNodeId: agentNode.id,
    toNodeId: responseNode.id,
    kind: "Sequential",
    ordinal: 0,
    label: null,
    maxIterations: null,
    conditionExpression: null,
    now: NOW,
  });
  agents.seedPublished("agt_billing");
  return pipelineVersionId;
}

describe("PublishPipelineVersion", () => {
  it("publishes a well-formed graph", async () => {
    const pipelines = new FakePipelineRepository();
    const agents = new FakePublishedAgentPort();
    const pipelineVersionId = await seedValidLinearPipeline(pipelines, agents);

    const result = await new PublishPipelineVersion({ pipelines, agents }).execute({
      pipelineVersionId,
      changeSummary: "Initial release",
      actorStaffUserId: "staff_1",
      now: NOW,
    });

    expect(result).toEqual({ ok: true, label: "v1.0" });
    const version = await pipelines.getPipelineVersion(pipelineVersionId);
    expect(version?.status).toBe("Published");
  });

  it("rejects a graph with no Response node, collecting the finding", async () => {
    const pipelines = new FakePipelineRepository();
    const agents = new FakePublishedAgentPort();
    const { pipelineVersionId } = await pipelines.createPipeline({
      name: "Incomplete",
      ownerTenantId: "tenant_1",
      createdByStaffUserId: "staff_1",
      now: NOW,
    });

    const result = await new PublishPipelineVersion({ pipelines, agents }).execute({
      pipelineVersionId,
      changeSummary: null,
      actorStaffUserId: "staff_1",
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("orchestration.pipeline.graph_invalid");
    if (result.reason !== "orchestration.pipeline.graph_invalid") return;
    expect(
      result.findings.some((f) => f.reason === "orchestration.pipeline.terminal_node_required"),
    ).toBe(true);
    // Never even attempted the repository write once the analyzer found a blocker.
    const version = await pipelines.getPipelineVersion(pipelineVersionId);
    expect(version?.status).toBe("Draft");
  });

  it("rejects a node referencing an unpublished agent", async () => {
    const pipelines = new FakePipelineRepository();
    const agents = new FakePublishedAgentPort();
    const pipelineVersionId = await seedValidLinearPipeline(pipelines, agents);
    // Un-publish the agent the node depends on.
    const unpublishedAgents = new FakePublishedAgentPort();

    const result = await new PublishPipelineVersion({
      pipelines,
      agents: unpublishedAgents,
    }).execute({
      pipelineVersionId,
      changeSummary: null,
      actorStaffUserId: "staff_1",
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("orchestration.pipeline.graph_invalid");
    if (result.reason !== "orchestration.pipeline.graph_invalid") return;
    expect(result.findings.some((f) => f.reason === "orchestration.pipeline.agent_not_published")).toBe(
      true,
    );
  });

  it("rejects publishing an already-Published version", async () => {
    const pipelines = new FakePipelineRepository();
    const agents = new FakePublishedAgentPort();
    const pipelineVersionId = await seedValidLinearPipeline(pipelines, agents);
    await new PublishPipelineVersion({ pipelines, agents }).execute({
      pipelineVersionId,
      changeSummary: null,
      actorStaffUserId: "staff_1",
      now: NOW,
    });

    const result = await new PublishPipelineVersion({ pipelines, agents }).execute({
      pipelineVersionId,
      changeSummary: null,
      actorStaffUserId: "staff_1",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "orchestration.pipeline.already_published" });
  });

  it("throws for a version id that does not exist", async () => {
    const pipelines = new FakePipelineRepository();
    const agents = new FakePublishedAgentPort();

    await expect(
      new PublishPipelineVersion({ pipelines, agents }).execute({
        pipelineVersionId: "pv_does_not_exist",
        changeSummary: null,
        actorStaffUserId: "staff_1",
        now: NOW,
      }),
    ).rejects.toThrow(/no such version/i);
  });
});
