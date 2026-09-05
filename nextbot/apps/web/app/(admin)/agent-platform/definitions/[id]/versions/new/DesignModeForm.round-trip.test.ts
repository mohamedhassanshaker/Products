import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { AgentDefinitionArtifactSchema, type AgentDefinitionArtifact } from "@nextbot/contracts";
import { artifactToFormValues, formValuesToArtifact } from "./DesignModeForm.js";

/**
 * Phase 9 (client-feedback-batch item 7) round-trip requirement: `artifactToFormValues`
 * then `formValuesToArtifact` must reconstruct a semantically equivalent artifact —
 * not necessarily byte-identical (capability groups get re-joined/re-split through a
 * comma-separated string, for instance), but the same parsed structure, still valid
 * against the exact schema Text mode itself validates against.
 */
describe("DesignModeForm artifact <-> form-values round trip", () => {
  const METADATA = { name: "support-triage", version: "1.0.0" };

  const ARTIFACTS: Array<{ label: string; artifact: AgentDefinitionArtifact }> = [
    {
      label: "a minimal artifact — empty capability groups, no escalation reasons, no evalSuite",
      artifact: {
        apiVersion: "nextbot.io/v1",
        kind: "AgentDefinition",
        metadata: METADATA,
        spec: {
          graphType: "ADK",
          modelRoute: "chat.primary",
          instructions: "You are a helpful support agent.",
          toolPolicy: { source: "agent-tool-registry", capabilityGroups: [], maxToolCallsPerTurn: 5 },
          guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
          memory: { strategy: "rolling-window", maxTurns: 20 },
          budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
        },
      },
    },
    {
      label: "a fully populated artifact — multiple capability groups, multiple escalation reasons, evalSuite set",
      artifact: {
        apiVersion: "nextbot.io/v1",
        kind: "AgentDefinition",
        metadata: METADATA,
        spec: {
          graphType: "CustomFSM",
          modelRoute: "reasoning.planner",
          instructions: "You are a billing specialist. Never disclose card numbers.",
          toolPolicy: { source: "agent-tool-registry", capabilityGroups: ["billing", "order-lookup"], maxToolCallsPerTurn: 12 },
          guardrails: { minConfidenceForAutonomy: 0.85, escalateOn: ["LowConfidence", "SensitiveTopic"] },
          memory: { strategy: "rolling-window", maxTurns: 40 },
          evalSuite: "support-golden-v3",
          budgets: { maxCostUsdPerConversation: "1.25", maxLatencyMsP95: 9000 },
        },
      },
    },
    {
      label: "an artifact with every escalation reason and a single capability group",
      artifact: {
        apiVersion: "nextbot.io/v1",
        kind: "AgentDefinition",
        metadata: METADATA,
        spec: {
          graphType: "LangGraph",
          modelRoute: "chat.fast",
          instructions: "You triage incoming tickets.",
          toolPolicy: { source: "agent-tool-registry", capabilityGroups: ["triage"], maxToolCallsPerTurn: 1 },
          guardrails: {
            minConfidenceForAutonomy: 0,
            escalateOn: ["LowConfidence", "ToolFailure", "CustomerRequest", "SensitiveTopic"],
          },
          memory: { strategy: "rolling-window", maxTurns: 1 },
          budgets: { maxCostUsdPerConversation: "0.00", maxLatencyMsP95: 0 },
        },
      },
    },
  ];

  it.each(ARTIFACTS)("round-trips $label", ({ artifact }) => {
    // Confirm the fixture itself is schema-valid before trusting the round trip.
    expect(Value.Check(AgentDefinitionArtifactSchema, artifact)).toBe(true);

    const formValues = artifactToFormValues(artifact);
    const rebuilt = formValuesToArtifact(formValues, METADATA);

    expect(Value.Check(AgentDefinitionArtifactSchema, rebuilt)).toBe(true);
    // Semantic equivalence (same parsed structure), not byte-identical YAML text.
    expect(rebuilt).toEqual(artifact);
  });

  it("drops an empty evalSuite back to undefined rather than round-tripping an empty string", () => {
    const minimal = ARTIFACTS[0]?.artifact;
    if (!minimal) throw new Error("fixture 0 missing");
    const artifact: AgentDefinitionArtifact = {
      ...minimal,
      spec: { ...minimal.spec, evalSuite: undefined },
    };
    const rebuilt = formValuesToArtifact(artifactToFormValues(artifact), METADATA);
    expect(rebuilt.spec.evalSuite).toBeUndefined();
  });

  it("round-trips capability groups as a real string[] (Phase 10 picker), not a comma-separated string", () => {
    const populated = ARTIFACTS[1]?.artifact;
    if (!populated) throw new Error("fixture 1 missing");
    const values = artifactToFormValues(populated);
    expect(values.toolPolicyCapabilityGroups).toEqual(["billing", "order-lookup"]);
    // Simulate the picker adding/removing a group (array mutation, no re-parsing needed).
    const edited = { ...values, toolPolicyCapabilityGroups: [...values.toolPolicyCapabilityGroups, "triage"] };
    const rebuilt = formValuesToArtifact(edited, METADATA);
    expect(rebuilt.spec.toolPolicy.capabilityGroups).toEqual(["billing", "order-lookup", "triage"]);
  });
});
