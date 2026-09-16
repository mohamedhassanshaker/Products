import { describe, expect, it } from "vitest";
import { FakePipelineRepository, FakePublishedAgentPort } from "../testing/fakes.js";
import { CreatePipelineNode } from "./create-pipeline-node.js";

const NOW = new Date("2026-09-16T10:00:00.000Z");

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    pipelineVersionId: "pv_1",
    kind: "Agent" as const,
    title: "Triage agent",
    canvasX: 100,
    canvasY: 100,
    agentId: null,
    usesTurnBoundAgent: false,
    agentVersionPinId: null,
    inputContextMode: "UserTurnOnly" as const,
    isOwningEntity: true,
    onErrorPolicy: "FailTurn" as const,
    now: NOW,
    ...overrides,
  };
}

describe("CreatePipelineNode", () => {
  it("creates a turn-bound agent node", async () => {
    const pipelines = new FakePipelineRepository();
    const agents = new FakePublishedAgentPort();
    const result = await new CreatePipelineNode({ pipelines, agents }).execute(
      baseInput({ usesTurnBoundAgent: true }),
    );
    expect(result.ok).toBe(true);
  });

  it("creates a fixed-agent node when the agent is Published", async () => {
    const pipelines = new FakePipelineRepository();
    const agents = new FakePublishedAgentPort();
    agents.seedPublished("agt_billing");
    const result = await new CreatePipelineNode({ pipelines, agents }).execute(
      baseInput({ agentId: "agt_billing" }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a fixed agent reference that is not Published", async () => {
    const pipelines = new FakePipelineRepository();
    const agents = new FakePublishedAgentPort();
    const result = await new CreatePipelineNode({ pipelines, agents }).execute(
      baseInput({ agentId: "agt_unpublished" }),
    );
    expect(result).toEqual({ ok: false, reason: "orchestration.pipeline.agent_not_published" });
  });

  it("rejects an Agent node with no agent reference at all", async () => {
    const pipelines = new FakePipelineRepository();
    const agents = new FakePublishedAgentPort();
    const result = await new CreatePipelineNode({ pipelines, agents }).execute(baseInput());
    expect(result).toEqual({ ok: false, reason: "orchestration.pipeline.agent_required" });
  });

  it("rejects a node that is both turn-bound and fixed to an agent", async () => {
    const pipelines = new FakePipelineRepository();
    const agents = new FakePublishedAgentPort();
    agents.seedPublished("agt_billing");
    const result = await new CreatePipelineNode({ pipelines, agents }).execute(
      baseInput({ usesTurnBoundAgent: true, agentId: "agt_billing" }),
    );
    expect(result).toEqual({
      ok: false,
      reason: "orchestration.pipeline.agent_and_turn_bound_are_exclusive",
    });
  });

  it("never checks the agent registry for Start/Response nodes", async () => {
    const pipelines = new FakePipelineRepository();
    const agents = new FakePublishedAgentPort();
    const result = await new CreatePipelineNode({ pipelines, agents }).execute(
      baseInput({ kind: "Response", title: "Response" }),
    );
    expect(result.ok).toBe(true);
  });
});
