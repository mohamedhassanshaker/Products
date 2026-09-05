import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createConnector } from "@nextbot/connectors";
import { upsertToolFromDiscovery, createCapabilityGroup } from "@nextbot/tool-registry";
import type { SkillArtifact } from "@nextbot/contracts";
import { AuthzRefNotYetSupportedError } from "@nextbot/contracts";
import { createSkill } from "@nextbot/skills";
import { simulate } from "./simulate-service.js";
import { evaluateOrDeny } from "./evaluate-or-deny.js";
import { getTenantScopePolicy } from "./tenant-scope-policy-service.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

function baseArtifact(overrides: Partial<SkillArtifact> = {}): SkillArtifact {
  return {
    kind: "skill",
    name: "refund_request",
    version: 1,
    trigger: "customer asks to reverse a completed payment",
    scope: { capabilityGroups: ["billing"], tools: ["payment.refund@billing_core"], knowledge: ["billing_policy"] },
    instructions: "Confirm the invoice and the amount before refunding.",
    successCriteria: "refund issued, or a stated reason why not",
    escalateWhen: ["amount > 500"],
    evalCases: [],
    ...overrides,
  };
}

describe("simulate() — LLD §14.2.7 (real Postgres): same evaluator code path as the runtime, never a parallel approximation", () => {
  it("an all-inline chain produces a result IDENTICAL (byte-for-byte, minus scopeHash which already covers the whole input) to calling evaluateOrDeny() directly with the equivalent input — proving no divergent logic lives in the ref-resolution layer", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const toolId = crypto.randomUUID();

    const tenantPolicy = await getTenantScopePolicy(ctx);
    const inlineScope = { origin: "AgentVersion" as const, originId: "v1", originLabel: "Agent v1", toolIds: [toolId] };

    const viaSimulate = await simulate(ctx, {
      chain: [{ ref: "inline", scope: inlineScope }],
      requested: { kind: "ToolCall", toolId },
      depth: 0,
    });

    const viaDirectEvaluate = await evaluateOrDeny(ctx, {
      tenantId: ctx.tenantId,
      tenantPolicy,
      chain: [inlineScope],
      requested: { kind: "ToolCall", toolId },
      depth: 0,
    });

    // scopeHash is a hash of the canonicalised input, which is identical between
    // the two calls (same tenantPolicy, same chain, same requested) -> the hashes
    // themselves being equal is itself part of the "same code path" proof: if
    // `simulate()` did ANYTHING different before delegating to the evaluator
    // (e.g. mutated the chain, added a hidden field), the hashes would diverge.
    expect(viaSimulate).toEqual(viaDirectEvaluate);
  });

  it("resolves a real skillVersion ref to a ScopeDescriptor and narrows a caller's chain against it for real", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await createConnector(ctx, {
      name: "billing_core",
      backendType: "Custom",
      transport: "StreamableHTTP",
      endpointUrl: "https://billing.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });
    const tool = await upsertToolFromDiscovery(ctx, {
      connectorId: connector.id,
      name: "payment.refund",
      descriptionSource: "Refund a payment",
      rwClass: "Write",
      approvalTier: "Tier2",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    });
    await createCapabilityGroup(ctx, { name: "billing" });
    const { version } = await createSkill(ctx, { name: "refund_request", artifact: baseArtifact() }, "00000000-0000-4000-8000-000000000001");

    // Caller's own scope only reaches a DIFFERENT tool — the skill's real,
    // resolved `payment.refund` tool id should be narrowed away entirely.
    const otherToolId = crypto.randomUUID();
    const denied = await simulate(ctx, {
      chain: [
        { ref: "inline", scope: { origin: "AgentVersion", originId: "v1", originLabel: "Agent v1", toolIds: [otherToolId] } },
        { ref: "skillVersion", id: version.id },
      ],
      requested: { kind: "ToolCall", toolId: tool.toolId },
    });
    expect(denied.decision).toBe("Deny");
    expect(denied.denyReason).toBe("TOOL_NOT_IN_SCOPE");

    // The caller DOES hold the skill's real tool -> Allow, and effectiveScope
    // narrows to exactly that one tool.
    const allowed = await simulate(ctx, {
      chain: [
        { ref: "inline", scope: { origin: "AgentVersion", originId: "v1", originLabel: "Agent v1", toolIds: [tool.toolId, otherToolId] } },
        { ref: "skillVersion", id: version.id },
      ],
      requested: { kind: "ToolCall", toolId: tool.toolId },
    });
    expect(allowed.decision).toBe("Allow");
    expect(allowed.effectiveScope?.toolIds).toEqual([tool.toolId]);
  });

  it("throws AuthzRefNotYetSupportedError for a ref kind whose artifact doesn't persist a real ScopeDescriptor yet in this build", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await expect(simulate(ctx, { chain: [{ ref: "agentVersion", id: crypto.randomUUID() }] })).rejects.toBeInstanceOf(AuthzRefNotYetSupportedError);
    await expect(simulate(ctx, { chain: [{ ref: "teamVersion", id: crypto.randomUUID() }] })).rejects.toBeInstanceOf(AuthzRefNotYetSupportedError);
  });
});
