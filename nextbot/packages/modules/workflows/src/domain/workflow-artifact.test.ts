import { describe, expect, it } from "vitest";
import { WorkflowGraphValidationError, type WorkflowGraph } from "@nextbot/contracts";
import { assertWorkflowGraph, hashWorkflowArtifact, parseWorkflowArtifact, serializeWorkflowArtifact } from "./workflow-artifact.js";

const VALID: WorkflowGraph = {
  apiVersion: "nextbot.io/v1",
  kind: "Workflow",
  metadata: { name: "wf_test", version: 1 },
  spec: {
    nodes: [
      { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "end_1" },
      { id: "end_1", kind: "End", outcome: "Resolved" },
    ],
    runLimits: { maxSteps: 10, maxCostUsd: 1, maxWallClockSeconds: 60, maxLoopIterations: 5, maxParallelBranches: 2, maxSubWorkflowDepth: 1 },
  },
};

describe("serializeWorkflowArtifact / parseWorkflowArtifact round-trip", () => {
  it("round-trips a valid artifact through YAML", () => {
    const yamlText = serializeWorkflowArtifact(VALID);
    expect(parseWorkflowArtifact(yamlText)).toEqual(VALID);
  });

  it("throws WorkflowGraphValidationError with WORKFLOW_ARTIFACT_INVALID_YAML for malformed YAML", () => {
    expect(() => parseWorkflowArtifact("kind: Workflow\n  bad indent: [")).toThrow(WorkflowGraphValidationError);
    try {
      parseWorkflowArtifact("kind: Workflow\n  bad indent: [");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowGraphValidationError);
      expect((err as WorkflowGraphValidationError).issues).toEqual([expect.objectContaining({ code: "WORKFLOW_ARTIFACT_INVALID_YAML" })]);
    }
  });

  it("throws WorkflowGraphValidationError with WORKFLOW_ARTIFACT_INVALID for well-formed YAML that fails the schema", () => {
    expect(() => parseWorkflowArtifact("kind: NotAWorkflow\n")).toThrow(WorkflowGraphValidationError);
  });
});

describe("assertWorkflowGraph", () => {
  it("returns the artifact unchanged when it's already valid", () => {
    expect(assertWorkflowGraph(VALID)).toEqual(VALID);
  });

  it("reports EVERY failing path, not just the first", () => {
    try {
      assertWorkflowGraph({ apiVersion: "wrong", kind: "Workflow" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowGraphValidationError);
      const issues = (err as WorkflowGraphValidationError).issues;
      expect(issues.length).toBeGreaterThan(1);
      expect(issues.every((i) => i.code === "WORKFLOW_ARTIFACT_INVALID")).toBe(true);
    }
  });
});

describe("hashWorkflowArtifact", () => {
  it("is deterministic for the same content", () => {
    expect(hashWorkflowArtifact(VALID)).toBe(hashWorkflowArtifact(structuredClone(VALID)));
  });

  it("changes when real content changes", () => {
    const changed: WorkflowGraph = { ...VALID, spec: { ...VALID.spec, runLimits: { ...VALID.spec.runLimits, maxSteps: 999 } } };
    expect(hashWorkflowArtifact(changed)).not.toBe(hashWorkflowArtifact(VALID));
  });

  it("does NOT change when only spec.layout changes — moving a box is never a new version", () => {
    const withLayout: WorkflowGraph = { ...VALID, spec: { ...VALID.spec, layout: { "trigger_1": { x: 0, y: 0 } } } };
    const withDifferentLayout: WorkflowGraph = { ...VALID, spec: { ...VALID.spec, layout: { "trigger_1": { x: 500, y: 500 } } } };
    expect(hashWorkflowArtifact(withLayout)).toBe(hashWorkflowArtifact(VALID));
    expect(hashWorkflowArtifact(withDifferentLayout)).toBe(hashWorkflowArtifact(VALID));
  });

  it("is order-independent for object keys (re-serializing with keys in a different order hashes identically)", () => {
    const reordered: WorkflowGraph = {
      kind: VALID.kind,
      apiVersion: VALID.apiVersion,
      spec: { runLimits: VALID.spec.runLimits, nodes: VALID.spec.nodes },
      metadata: { version: VALID.metadata.version, name: VALID.metadata.name },
    };
    expect(hashWorkflowArtifact(reordered)).toBe(hashWorkflowArtifact(VALID));
  });
});
