import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import { diffArtifact, diffParsedArtifact, diffKeyedArray, diffSetArray, type Change } from "./index.js";

const BASE_ARTIFACT = {
  apiVersion: "nextbot.io/v1",
  kind: "AgentDefinition",
  metadata: { name: "support-agent", version: "1.0.0" },
  spec: {
    graphType: "CustomFSM",
    modelRoute: "chat.primary",
    instructions: "Help the customer.",
    toolPolicy: { source: "agent-tool-registry", capabilityGroups: ["billing", "shipping"], maxToolCallsPerTurn: 5 },
    guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: ["refund_over_limit"] },
    memory: { strategy: "rolling-window", maxTurns: 20 },
    budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
  },
};

describe("diffArtifact / diffParsedArtifact (ADR-0016 §6 verification list)", () => {
  it("Verification 2: two versions differing only in key order, comments, or whitespace diff as empty", () => {
    const leftYaml = yaml.dump(BASE_ARTIFACT);
    // Same document, but with keys emitted in a different order and extra whitespace
    // — YAML comments have no representation once parsed, so re-dumping already
    // exercises "comment differences produce no diff" (a comment simply isn't part of
    // the parsed value either input diffs against).
    const reordered = {
      kind: BASE_ARTIFACT.kind,
      apiVersion: BASE_ARTIFACT.apiVersion,
      spec: { ...BASE_ARTIFACT.spec, budgets: { maxLatencyMsP95: 6000, maxCostUsdPerConversation: "0.50" } },
      metadata: { version: "1.0.0", name: "support-agent" },
    };
    const rightYaml = `\n\n${yaml.dump(reordered)}\n`;
    expect(diffArtifact("AgentVersion", leftYaml, rightYaml)).toEqual([]);
  });

  it("detects a real scalar change and tags it security-relevant when it's under spec.toolPolicy", () => {
    const left = BASE_ARTIFACT;
    const right = { ...BASE_ARTIFACT, spec: { ...BASE_ARTIFACT.spec, toolPolicy: { ...BASE_ARTIFACT.spec.toolPolicy, maxToolCallsPerTurn: 10 } } };
    const changes = diffParsedArtifact("AgentVersion", left, right);
    expect(changes).toEqual([{ op: "changed", path: "spec.toolPolicy.maxToolCallsPerTurn", before: 5, after: 10, securityRelevant: true }]);
  });

  it("Verification 4: a change to a tool-policy field, a guardrail field, or a model-route pin is tagged security-relevant and sorts first", () => {
    const left = BASE_ARTIFACT;
    const right = {
      ...BASE_ARTIFACT,
      spec: {
        ...BASE_ARTIFACT.spec,
        modelRoute: "chat.secondary",
        instructions: "Help the customer more.",
        guardrails: { ...BASE_ARTIFACT.spec.guardrails, minConfidenceForAutonomy: 0.8 },
      },
    };
    const changes = diffParsedArtifact("AgentVersion", left, right);
    // Two security-relevant changes (modelRoute, guardrails) and one non-security
    // change (instructions) — the security-relevant ones sort first.
    const securityRelevantCount = changes.filter((c) => c.securityRelevant).length;
    expect(securityRelevantCount).toBe(2);
    expect(changes[0]?.securityRelevant).toBe(true);
    expect(changes[1]?.securityRelevant).toBe(true);
    expect(changes[2]?.securityRelevant).toBe(false);
    expect(changes.at(-1)).toMatchObject({ path: "spec.instructions", securityRelevant: false });
  });

  it("a capabilityGroups/escalateOn reorder produces no diff (declared 'set' mode — order is not semantic)", () => {
    const left = BASE_ARTIFACT;
    const right = { ...BASE_ARTIFACT, spec: { ...BASE_ARTIFACT.spec, toolPolicy: { ...BASE_ARTIFACT.spec.toolPolicy, capabilityGroups: ["shipping", "billing"] } } };
    expect(diffParsedArtifact("AgentVersion", left, right)).toEqual([]);
  });

  it("a genuine capabilityGroups membership change (not just reorder) is reported as added/removed, not 'changed'", () => {
    const left = BASE_ARTIFACT;
    const right = { ...BASE_ARTIFACT, spec: { ...BASE_ARTIFACT.spec, toolPolicy: { ...BASE_ARTIFACT.spec.toolPolicy, capabilityGroups: ["billing", "returns"] } } };
    const changes = diffParsedArtifact("AgentVersion", left, right);
    expect(changes).toContainEqual({ op: "removed", path: "spec.toolPolicy.capabilityGroups", before: "shipping", securityRelevant: true });
    expect(changes).toContainEqual({ op: "added", path: "spec.toolPolicy.capabilityGroups", after: "returns", securityRelevant: true });
  });

  it("Verification 3 (keyed-array test): inserting a member at the front of a keyed array produces exactly one 'added' change, not N 'changed' ones", () => {
    const left = [
      { id: "step-1", tier: "Tier1" },
      { id: "step-2", tier: "Tier2" },
    ];
    const right = [
      { id: "step-0", tier: "Tier1" },
      { id: "step-1", tier: "Tier1" },
      { id: "step-2", tier: "Tier2" },
    ];
    const out: Change[] = [];
    diffKeyedArray("WorkflowVersion", "spec.nodes", "id", left, right, out);
    expect(out).toEqual([{ op: "added", path: "spec.nodes[step-0]", after: { id: "step-0", tier: "Tier1" }, securityRelevant: false }]);
  });

  it("keyed-array test: a changed field on an existing keyed member reports one path-scoped 'changed', not a whole-array diff", () => {
    const left = [{ id: "step-1", tier: "Tier1" }];
    const right = [{ id: "step-1", tier: "Tier3" }];
    const out: Change[] = [];
    diffKeyedArray("WorkflowVersion", "spec.nodes", "id", left, right, out);
    expect(out).toEqual([{ op: "changed", path: "spec.nodes[step-1].tier", before: "Tier1", after: "Tier3", securityRelevant: false }]);
  });

  it("set-array test: membership changes are added/removed, ignoring order, via the exported diffSetArray directly", () => {
    const out: Change[] = [];
    diffSetArray("AgentVersion", "spec.toolPolicy.capabilityGroups", ["a", "b"], ["b", "c"], out);
    expect(out).toEqual([
      { op: "added", path: "spec.toolPolicy.capabilityGroups", after: "c", securityRelevant: true },
      { op: "removed", path: "spec.toolPolicy.capabilityGroups", before: "a", securityRelevant: true },
    ]);
  });

  it("an array path with no declared config (positional fallback) produces one noisy-but-honest 'changed', never silently wrong", () => {
    const changes = diffParsedArtifact("WorkflowVersion", { spec: { undeclaredArray: [1, 2, 3] } }, { spec: { undeclaredArray: [3, 2, 1] } });
    expect(changes).toEqual([{ op: "changed", path: "spec.undeclaredArray", before: [1, 2, 3], after: [3, 2, 1], securityRelevant: false }]);
  });

  it("identical documents produce an empty change set", () => {
    expect(diffParsedArtifact("AgentVersion", BASE_ARTIFACT, structuredClone(BASE_ARTIFACT))).toEqual([]);
  });

  describe("Target Architecture Blueprint Phase 15 (BL-47a) — WorkflowVersion security-tag wildcard matching", () => {
    it("a per-node scope change IS tagged security-relevant regardless of the node's own id (`spec.nodes[*].scope`)", () => {
      const left = { spec: { nodes: [{ id: "step-1", kind: "ToolCall", scope: { toolIds: ["a"] } }] } };
      const right = { spec: { nodes: [{ id: "step-1", kind: "ToolCall", scope: { toolIds: ["a", "b"] } }] } };
      const changes = diffParsedArtifact("WorkflowVersion", left, right);
      expect(changes).toEqual([{ op: "changed", path: "spec.nodes[step-1].scope.toolIds", before: ["a"], after: ["a", "b"], securityRelevant: true }]);
    });

    it("a per-node pinned toolId change is tagged security-relevant (`spec.nodes[*].toolId`)", () => {
      const left = { spec: { nodes: [{ id: "call-a", kind: "ToolCall", toolId: "11111111-1111-1111-1111-111111111111" }] } };
      const right = { spec: { nodes: [{ id: "call-a", kind: "ToolCall", toolId: "22222222-2222-2222-2222-222222222222" }] } };
      const changes = diffParsedArtifact("WorkflowVersion", left, right);
      expect(changes).toEqual([
        { op: "changed", path: "spec.nodes[call-a].toolId", before: "11111111-1111-1111-1111-111111111111", after: "22222222-2222-2222-2222-222222222222", securityRelevant: true },
      ]);
    });

    it("a non-security field on a node (e.g. `label`) is NOT tagged security-relevant", () => {
      const left = { spec: { nodes: [{ id: "step-1", kind: "ToolCall", label: "Old label" }] } };
      const right = { spec: { nodes: [{ id: "step-1", kind: "ToolCall", label: "New label" }] } };
      const changes = diffParsedArtifact("WorkflowVersion", left, right);
      expect(changes).toEqual([{ op: "changed", path: "spec.nodes[step-1].label", before: "Old label", after: "New label", securityRelevant: false }]);
    });

    it("`spec.nodes` is diffed as a keyed array (by node `id`) — inserting a node produces one 'added', never a whole-array 'changed'", () => {
      const left = { spec: { nodes: [{ id: "step-1", kind: "End", outcome: "Resolved" }] } };
      const right = {
        spec: {
          nodes: [
            { id: "step-0", kind: "Agent", label: "New" },
            { id: "step-1", kind: "End", outcome: "Resolved" },
          ],
        },
      };
      const changes = diffParsedArtifact("WorkflowVersion", left, right);
      expect(changes).toEqual([{ op: "added", path: "spec.nodes[step-0]", after: { id: "step-0", kind: "Agent", label: "New" }, securityRelevant: false }]);
    });

    it("a `spec.runLimits` change is tagged security-relevant (a safety-ceiling change, not a cosmetic one)", () => {
      const changes = diffParsedArtifact("WorkflowVersion", { spec: { runLimits: { maxSteps: 10 } } }, { spec: { runLimits: { maxSteps: 20 } } });
      expect(changes).toEqual([{ op: "changed", path: "spec.runLimits.maxSteps", before: 10, after: 20, securityRelevant: true }]);
    });
  });
});
