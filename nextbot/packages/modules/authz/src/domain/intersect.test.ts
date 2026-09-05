import { describe, expect, it } from "vitest";
import type { PermissionIntersectionInput, ScopeDescriptor } from "@nextbot/contracts";
import { evaluate } from "./intersect.js";

/**
 * LLD §14.2.4's edge-case table (E1–E14), transcribed into real, independent unit
 * tests — every one of the table's rows is a `describe`/`it` below, plus
 * ADR-0012 §6's own verification list (the escalation test, the tier-survival
 * scenario) and a fold order-independence property test proving the algorithm's
 * "associative/commutative" claim rather than merely asserting it in a comment.
 */

function uuid(): string {
  return crypto.randomUUID();
}

function tenantPolicy(overrides: Partial<ScopeDescriptor> = {}): ScopeDescriptor {
  return { origin: "TenantPolicy", originId: "tenant", originLabel: "Tenant default policy", ...overrides };
}

function agentVersionScope(overrides: Partial<ScopeDescriptor> = {}): ScopeDescriptor {
  return { origin: "AgentVersion", originId: "agent-v1", originLabel: "Agent v1", ...overrides };
}

function teamMemberScope(overrides: Partial<ScopeDescriptor> = {}): ScopeDescriptor {
  return { origin: "TeamMember", originId: "billing_agent", originLabel: "Billing Agent", ...overrides };
}

function baseInput(overrides: Partial<PermissionIntersectionInput> = {}): PermissionIntersectionInput {
  return {
    tenantId: uuid(),
    tenantPolicy: tenantPolicy(),
    chain: [agentVersionScope()],
    depth: 0,
    ...overrides,
  };
}

describe("evaluate() — LLD §14.2.3 baseline behaviour", () => {
  it("with no `requested`, computes the effective scope without authorising any specific call (step 3)", () => {
    const result = evaluate(baseInput());
    expect(result.decision).toBe("Allow");
    expect(result.effectiveScope).toBeDefined();
    expect(result.requiredTier).toBeUndefined();
    expect(result.requiresApproval).toBeUndefined();
    expect(result.trace.length).toBeGreaterThan(0);
    expect(result.scopeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a tool reachable via an unrestricted (⊤) scope is Allowed", () => {
    const toolId = uuid();
    const result = evaluate(baseInput({ requested: { kind: "ToolCall", toolId, toolApprovalTier: "Tier1" } }));
    expect(result.decision).toBe("Allow");
    expect(result.requiredTier).toBe("Tier1");
    expect(result.requiresApproval).toBe(false);
  });
});

describe("E1 — an empty dimension intersection that the request actually exercises denies (never 'empty means unrestricted')", () => {
  it("disjoint toolIds AND disjoint capabilityGroupIds across the chain -> Deny(EMPTY_CAPABILITY_INTERSECTION)", () => {
    const toolA = uuid();
    const toolB = uuid();
    const groupA = uuid();
    const groupB = uuid();
    const result = evaluate(
      baseInput({
        chain: [
          agentVersionScope({ toolIds: [toolA], capabilityGroupIds: [groupA] }),
          teamMemberScope({ toolIds: [toolB], capabilityGroupIds: [groupB] }),
        ],
        requested: { kind: "ToolCall", toolId: uuid() },
      }),
    );
    expect(result.decision).toBe("Deny");
    expect(result.denyReason).toBe("EMPTY_CAPABILITY_INTERSECTION");
  });

  it("disjoint toolIds only (capabilityGroupIds still has members) -> Deny(TOOL_NOT_IN_SCOPE), not EMPTY_CAPABILITY_INTERSECTION", () => {
    const toolA = uuid();
    const toolB = uuid();
    const group = uuid();
    // capabilityGroupIds is narrowed to a real, non-'*' set at every level here —
    // step 4b's `eff.capabilityGroupIds === '*'` disjunct would otherwise make
    // ANY tool reachable regardless of toolIds (see the dedicated test below for
    // that exact, literal-per-LLD behaviour) — so this scenario has to close that
    // door itself to actually exercise the toolIds-only path.
    const result = evaluate(
      baseInput({
        chain: [
          agentVersionScope({ toolIds: [toolA], capabilityGroupIds: [group] }),
          teamMemberScope({ toolIds: [toolB], capabilityGroupIds: [group] }),
        ],
        requested: { kind: "ToolCall", toolId: uuid() },
      }),
    );
    expect(result.decision).toBe("Deny");
    expect(result.denyReason).toBe("TOOL_NOT_IN_SCOPE");
  });

  it("LLD §14.2.3 step 4b's literal OR: eff.capabilityGroupIds === '*' makes ANY tool reachable regardless of toolIds narrowing, when the request doesn't specify a capability group either — a deliberate, tested property of the specified algorithm, not an approximation", () => {
    const toolA = uuid();
    const toolB = uuid();
    const result = evaluate(
      baseInput({
        // toolIds narrows to just [toolA] — but capabilityGroupIds is never
        // touched by either level, so it stays at ⊤ ('*').
        chain: [agentVersionScope({ toolIds: [toolA] })],
        requested: { kind: "ToolCall", toolId: toolB }, // NOT toolA
      }),
    );
    expect(result.decision).toBe("Allow");
  });

  it("empty rwClasses intersection denies an rw-classified request", () => {
    const result = evaluate(
      baseInput({
        chain: [agentVersionScope({ rwClasses: ["Read"] }), teamMemberScope({ rwClasses: ["Write"] })],
        requested: { kind: "ToolCall", toolRwClass: "Write" },
      }),
    );
    expect(result.decision).toBe("Deny");
    expect(result.denyReason).toBe("RW_CLASS_NOT_PERMITTED");
  });
});

describe("E2 — an unrecognised scope dimension name fails closed, never silently dropped", () => {
  it("Deny(SCOPE_MALFORMED) for an unknown key on a chain scope descriptor", () => {
    const malformed = {
      tenantId: uuid(),
      tenantPolicy: tenantPolicy(),
      chain: [{ ...agentVersionScope(), notARealDimension: ["whatever"] }],
      depth: 0,
    };
    const result = evaluate(malformed);
    expect(result.decision).toBe("Deny");
    expect(result.denyReason).toBe("SCOPE_MALFORMED");
  });

  it("Deny(SCOPE_MALFORMED) for an unknown key on tenantPolicy itself", () => {
    const malformed = {
      tenantId: uuid(),
      tenantPolicy: { ...tenantPolicy(), someFutureField: true },
      chain: [agentVersionScope()],
      depth: 0,
    };
    const result = evaluate(malformed);
    expect(result.decision).toBe("Deny");
    expect(result.denyReason).toBe("SCOPE_MALFORMED");
  });
});

describe("E3 — a dimension absent from an artifact scope inherits the caller (⊤ for that level), never treated as empty or as '*'", () => {
  it("a chain level that omits toolIds does not disturb a narrower value already established by an earlier level", () => {
    const toolA = uuid();
    const result = evaluate(
      baseInput({
        chain: [agentVersionScope({ toolIds: [toolA] }), teamMemberScope()], // teamMemberScope declares nothing for toolIds
        requested: { kind: "ToolCall", toolId: toolA },
      }),
    );
    expect(result.decision).toBe("Allow");
    expect(result.effectiveScope?.toolIds).toEqual([toolA]);
  });
});

describe("E4 — an artifact declaring toolIds: '*' is capped to the caller's set, never widens it", () => {
  it("'*' at a later level cannot restore a tool already excluded by an earlier level", () => {
    const toolA = uuid();
    const toolB = uuid();
    const group = uuid();
    const result = evaluate(
      baseInput({
        chain: [
          agentVersionScope({ toolIds: [toolA], capabilityGroupIds: [group] }),
          teamMemberScope({ toolIds: "*", capabilityGroupIds: [group] }),
        ],
        requested: { kind: "ToolCall", toolId: toolB },
      }),
    );
    expect(result.decision).toBe("Deny");
    expect(result.denyReason).toBe("TOOL_NOT_IN_SCOPE");
  });
});

describe("E5 — chain length 1 (top-level channel-initiated turn): no implicit ⊤ system caller", () => {
  it("a single-element chain folds as tenantPolicy ∧ agentVersionScope", () => {
    const toolA = uuid();
    const result = evaluate(
      baseInput({ chain: [agentVersionScope({ toolIds: [toolA] })], requested: { kind: "ToolCall", toolId: toolA } }),
    );
    expect(result.decision).toBe("Allow");
  });

  it("chain[0].origin === 'TenantPolicy' is rejected structurally — an actor:{type:'system'} caller cannot bypass the evaluator by masquerading as the tenant floor", () => {
    const result = evaluate(baseInput({ chain: [tenantPolicy()] }));
    expect(result.decision).toBe("Deny");
    expect(result.denyReason).toBe("SCOPE_MALFORMED");
  });
});

describe("E6 — Tier-3 tool under a Tier-1 autonomy ceiling: Allow + requiresApproval, NEVER Deny", () => {
  it("returns Allow, requiredTier: 'Tier3', requiresApproval: true", () => {
    const result = evaluate(
      baseInput({
        chain: [agentVersionScope({ autonomyCeiling: "Tier1" })],
        requested: { kind: "ToolCall", toolId: uuid(), toolApprovalTier: "Tier3" },
      }),
    );
    expect(result.decision).toBe("Allow");
    expect(result.requiredTier).toBe("Tier3");
    expect(result.requiresApproval).toBe(true);
    expect(result.denyReason).toBeUndefined();
  });
});

describe("E7 — a scope cannot LOWER a tool's tier (minRequiredTier only ever raises the floor — step 5 is a max)", () => {
  it("minRequiredTier: 'Tier1' has no effect on a Tier-3 tool's requiredTier", () => {
    const result = evaluate(
      baseInput({
        chain: [agentVersionScope({ minRequiredTier: "Tier1" })],
        requested: { kind: "ToolCall", toolId: uuid(), toolApprovalTier: "Tier3" },
      }),
    );
    expect(result.decision).toBe("Allow");
    expect(result.requiredTier).toBe("Tier3");
  });

  it("minRequiredTier: 'Tier3' RAISES a Tier-1 tool's requiredTier", () => {
    const result = evaluate(
      baseInput({
        chain: [agentVersionScope({ minRequiredTier: "Tier3" })],
        requested: { kind: "ToolCall", toolId: uuid(), toolApprovalTier: "Tier1" },
      }),
    );
    expect(result.decision).toBe("Allow");
    expect(result.requiredTier).toBe("Tier3");
  });
});

describe("E8 — a specialist's scope that is a strict superset of the supervisor's is narrowed to the supervisor's; the extra capability is unreachable", () => {
  it("the specialist's extra tool never enters the effective scope, and the request rejects if it exercises exactly that tool (the escalation-prevention invariant, ADR-0012 §6 test 1)", () => {
    const supervisorTool = uuid();
    const specialistOnlyTool = uuid();
    const group = uuid();
    const result = evaluate(
      baseInput({
        chain: [
          agentVersionScope({ toolIds: [supervisorTool], capabilityGroupIds: [group] }),
          teamMemberScope({ toolIds: [supervisorTool, specialistOnlyTool], capabilityGroupIds: [group] }),
        ],
        requested: { kind: "ToolCall", toolId: specialistOnlyTool },
      }),
    );
    expect(result.decision).toBe("Deny");
    expect(result.denyReason).toBe("TOOL_NOT_IN_SCOPE");
    // `effectiveScope` is only present on Allow (per the contract) — the fold's
    // actual narrowed value is asserted via `trace` instead, which is "always
    // populated, on Allow and Deny alike".
    const toolIdsTraceForTeamMember = result.trace.filter((t) => t.dimension === "toolIds").at(-1);
    expect(toolIdsTraceForTeamMember?.after).toEqual([supervisorTool]);
    // The trace shows the TeamMember level did NOT narrow this dimension further
    // (it was already narrowed by the supervisor's own AgentVersion level) —
    // exactly LLD's "narrowedBy: 'TeamMember' -> null" example.
    expect(toolIdsTraceForTeamMember?.narrowedBy).toBeNull();
  });
});

describe("E9 — budget.usdPerTurn undefined at every level is treated as +∞, never a zero cap", () => {
  it("a very large consumed.usd is not denied when no level ever declared a usdPerTurn cap", () => {
    const result = evaluate(baseInput({ consumed: { usd: 999_999, seconds: 0, steps: 0, delegations: 0, fanOut: 0 } }));
    expect(result.decision).toBe("Allow");
  });
});

describe("E10 — conflicting maskingFloor across levels: strictest wins", () => {
  it("Redact beats PartialMask regardless of which level declares which, in either order", () => {
    const forward = evaluate(
      baseInput({
        chain: [
          agentVersionScope({ maskingFloor: { Transcript: "PartialMask" } }),
          teamMemberScope({ maskingFloor: { Transcript: "Redact" } }),
        ],
      }),
    );
    const backward = evaluate(
      baseInput({
        chain: [
          agentVersionScope({ maskingFloor: { Transcript: "Redact" } }),
          teamMemberScope({ maskingFloor: { Transcript: "PartialMask" } }),
        ],
      }),
    );
    expect(forward.effectiveScope?.maskingFloor).toEqual({ Transcript: "Redact" });
    expect(backward.effectiveScope?.maskingFloor).toEqual({ Transcript: "Redact" });
  });
});

describe("E11 — the evaluator itself throwing is evaluateOrDeny()'s job (application/evaluate-or-deny.test.ts), not evaluate()'s", () => {
  it("evaluate() never throws for a merely-malformed input — it returns Deny(SCOPE_MALFORMED) instead", () => {
    expect(() => evaluate({ garbage: true })).not.toThrow();
    expect(evaluate({ garbage: true }).decision).toBe("Deny");
  });
});

describe("E12 — depth === maxDepth exactly is legal; only depth > maxDepth denies (fencepost)", () => {
  it("depth 2 with maxDepth 2 is Allowed", () => {
    const result = evaluate(baseInput({ chain: [agentVersionScope({ budget: { maxDepth: 2 } })], depth: 2 }));
    expect(result.decision).toBe("Allow");
  });

  it("depth 3 with maxDepth 2 is Denied", () => {
    const result = evaluate(baseInput({ chain: [agentVersionScope({ budget: { maxDepth: 2 } })], depth: 3 }));
    expect(result.decision).toBe("Deny");
    expect(result.denyReason).toBe("DELEGATION_DEPTH_EXCEEDED");
  });
});

describe("E13 — deniedToolIds wins over BOTH reachability paths (direct toolIds AND capability group)", () => {
  it("a tool reachable via its capability group is still denied once explicitly listed in deniedToolIds", () => {
    const groupId = uuid();
    const toolId = uuid();
    const result = evaluate(
      baseInput({
        chain: [agentVersionScope({ capabilityGroupIds: [groupId], deniedToolIds: [toolId] })],
        requested: { kind: "ToolCall", toolId, toolCapabilityGroupId: groupId },
      }),
    );
    expect(result.decision).toBe("Deny");
    expect(result.denyReason).toBe("TOOL_EXPLICITLY_DENIED");
  });

  it("a tool reachable directly via toolIds is still denied once explicitly listed in deniedToolIds", () => {
    const toolId = uuid();
    const result = evaluate(
      baseInput({
        chain: [agentVersionScope({ toolIds: [toolId], deniedToolIds: [toolId] })],
        requested: { kind: "ToolCall", toolId },
      }),
    );
    expect(result.decision).toBe("Deny");
    expect(result.denyReason).toBe("TOOL_EXPLICITLY_DENIED");
  });
});

describe("E14 — retrieval: the evaluator's role is to produce a narrowed effectiveScope.knowledgeCollectionIds; pre-ranking filtering is the (Phase 7+) retrieval executor's job, not this evaluator's", () => {
  it("a KnowledgeRetrieval request narrows to the intersection of every level's knowledgeCollectionIds", () => {
    const collectionA = uuid();
    const collectionB = uuid();
    const result = evaluate(
      baseInput({
        chain: [agentVersionScope({ knowledgeCollectionIds: [collectionA, collectionB] }), teamMemberScope({ knowledgeCollectionIds: [collectionA] })],
        requested: { kind: "KnowledgeRetrieval", knowledgeCollectionIds: [collectionA] },
      }),
    );
    expect(result.decision).toBe("Allow");
    expect(result.effectiveScope?.knowledgeCollectionIds).toEqual([collectionA]);
  });

  it("requesting a collection outside the narrowed set denies", () => {
    const collectionA = uuid();
    const collectionB = uuid();
    const result = evaluate(
      baseInput({
        chain: [agentVersionScope({ knowledgeCollectionIds: [collectionA] })],
        requested: { kind: "KnowledgeRetrieval", knowledgeCollectionIds: [collectionB] },
      }),
    );
    expect(result.decision).toBe("Deny");
    expect(result.denyReason).toBe("KNOWLEDGE_COLLECTION_NOT_IN_SCOPE");
  });
});

describe("Three-way narrowing — caller scope ∩ artifact scope ∩ tenant policy simultaneously, not merely two of the three", () => {
  it("the effective toolIds is the intersection across ALL THREE levels (tenant policy, caller, artifact/callee)", () => {
    const a = uuid();
    const b = uuid();
    const c = uuid();
    const result = evaluate({
      tenantId: uuid(),
      tenantPolicy: tenantPolicy({ toolIds: [a, b, c] }),
      chain: [agentVersionScope({ toolIds: [a, b] }), teamMemberScope({ toolIds: [a, c] })],
      depth: 0,
    });
    expect(result.decision).toBe("Allow");
    expect(result.effectiveScope?.toolIds).toEqual([a]);
  });

  it("a tool present in two of the three levels but missing from the third is still unreachable", () => {
    const a = uuid();
    const b = uuid();
    const group = uuid();
    const result = evaluate({
      tenantId: uuid(),
      tenantPolicy: tenantPolicy({ toolIds: [a, b], capabilityGroupIds: [group] }),
      // capabilityGroupIds narrowed to a real, matching set at every level too —
      // otherwise the fold never leaves eff.capabilityGroupIds at '*', and step
      // 4b's `capabilityGroupIds === '*'` disjunct would make 'a' reachable
      // regardless of the toolIds narrowing this test means to exercise.
      chain: [
        agentVersionScope({ toolIds: [a, b], capabilityGroupIds: [group] }),
        teamMemberScope({ toolIds: [b], capabilityGroupIds: [group] }), // 'a' missing only here
      ],
      depth: 0,
      requested: { kind: "ToolCall", toolId: a },
    });
    expect(result.decision).toBe("Deny");
    expect(result.denyReason).toBe("TOOL_NOT_IN_SCOPE");
  });
});

describe("ADR-0012 §6 test 2 (tier-survival) — a Tier-3 tool reached at any depth still resolves to requiredTier 'Tier3', never silently downgraded by depth or chain length", () => {
  it.each([0, 1, 3])("depth %i still resolves requiredTier 'Tier3' for a Tier-3 tool (⊤ autonomyCeiling is 'Tier3', so this does not itself require approval — that's the next test's scenario)", (depth) => {
    const result = evaluate(
      baseInput({
        chain: depth === 0 ? [agentVersionScope()] : [agentVersionScope(), teamMemberScope()],
        depth,
        requested: { kind: "ToolCall", toolId: uuid(), toolApprovalTier: "Tier3" },
      }),
    );
    expect(result.decision).toBe("Allow");
    expect(result.requiredTier).toBe("Tier3");
    expect(result.requiresApproval).toBe(false);
  });

  it.each([0, 1, 3])("depth %i: a Tier-3 tool under a Tier-1 autonomy ceiling still requires approval at EVERY depth — the ceiling survives the hop, it is never bypassed by delegation depth", (depth) => {
    const result = evaluate(
      baseInput({
        chain: depth === 0 ? [agentVersionScope({ autonomyCeiling: "Tier1" })] : [agentVersionScope(), teamMemberScope({ autonomyCeiling: "Tier1" })],
        depth,
        requested: { kind: "ToolCall", toolId: uuid(), toolApprovalTier: "Tier3" },
      }),
    );
    expect(result.decision).toBe("Allow");
    expect(result.requiredTier).toBe("Tier3");
    expect(result.requiresApproval).toBe(true);
  });
});

describe("Step 4e/4f — channel/environment reachability", () => {
  it("denies a channelType outside the narrowed channelTypes set", () => {
    const result = evaluate(
      baseInput({
        chain: [agentVersionScope({ channelTypes: ["WebWidget"] })],
        requested: { kind: "ToolCall", channelType: "WhatsApp" },
      }),
    );
    expect(result.decision).toBe("Deny");
    expect(result.denyReason).toBe("CHANNEL_NOT_IN_SCOPE");
  });

  it("denies an environment outside the narrowed environments set", () => {
    const result = evaluate(
      baseInput({
        chain: [agentVersionScope({ environments: ["Production"] })],
        requested: { kind: "ToolCall", environment: "Sandbox" },
      }),
    );
    expect(result.decision).toBe("Deny");
    expect(result.denyReason).toBe("ENVIRONMENT_NOT_IN_SCOPE");
  });
});

describe("Residency (step 4g)", () => {
  it("denies when targetRegion differs from the tenant's residency region and allowOutOfRegionInference is false", () => {
    const result = evaluate(
      baseInput({
        tenantResidencyRegion: "UAE",
        chain: [agentVersionScope({ allowOutOfRegionInference: false })],
        requested: { kind: "ModelCall", targetRegion: "EU" },
      }),
    );
    expect(result.decision).toBe("Deny");
    expect(result.denyReason).toBe("RESIDENCY_VIOLATION");
  });

  it("allows when allowOutOfRegionInference is true even if the regions differ", () => {
    const result = evaluate(
      baseInput({
        tenantResidencyRegion: "UAE",
        chain: [agentVersionScope({ allowOutOfRegionInference: true })],
        requested: { kind: "ModelCall", targetRegion: "EU" },
      }),
    );
    expect(result.decision).toBe("Allow");
  });

  it("is not applicable (never denies) when the tenant residency region wasn't supplied", () => {
    const result = evaluate(
      baseInput({
        chain: [agentVersionScope({ allowOutOfRegionInference: false })],
        requested: { kind: "ModelCall", targetRegion: "EU" },
      }),
    );
    expect(result.decision).toBe("Allow");
  });
});

describe("Fold order-independence (LLD §14.2.3's own claim: 'the fold is associative and commutative on every dimension')", () => {
  it("permuting the chain's artifact-level order never changes the decision or the resolved dimension values", () => {
    const toolA = uuid();
    const toolB = uuid();
    const levelOne = agentVersionScope({ toolIds: [toolA, toolB], rwClasses: ["Read"], maskingFloor: { Transcript: "PartialMask" } });
    const levelTwo = teamMemberScope({ toolIds: [toolA], rwClasses: ["Read", "Write"], maskingFloor: { Transcript: "Redact" } });

    const forward = evaluate(baseInput({ chain: [levelOne, levelTwo], requested: { kind: "ToolCall", toolId: toolA, toolRwClass: "Read" } }));
    const backward = evaluate(baseInput({ chain: [levelTwo, levelOne], requested: { kind: "ToolCall", toolId: toolA, toolRwClass: "Read" } }));

    expect(forward.decision).toBe(backward.decision);
    expect(forward.effectiveScope?.toolIds).toEqual(backward.effectiveScope?.toolIds);
    expect(forward.effectiveScope?.rwClasses).toEqual(backward.effectiveScope?.rwClasses);
    expect(forward.effectiveScope?.maskingFloor).toEqual(backward.effectiveScope?.maskingFloor);
  });
});

/**
 * Target Architecture Blueprint Phase 14 (BL-46) regression suite —
 * `effectiveScope` round-trippability.
 *
 * `PermissionIntersectionResult.effectiveScope`'s own contract is "the caller MUST
 * pass this (not its own scope) to the next hop". The delegation executor does
 * exactly that, literally appending it as the next hop's chain level. That makes
 * "the returned effectiveScope is itself a valid chain-level input" a hard
 * requirement, not a nicety — and it was NOT true before Phase 14 found it:
 * `minRequiredTier`'s lattice top is `null`, which `ScopeDescriptorSchema` (an
 * OPTIONAL `ApprovalTier`, no `null` member) rejects at step 0, fail-closed-denying
 * every multi-hop delegation with `SCOPE_MALFORMED`.
 */
describe("effectiveScope round-trippability — the value a caller MUST pass to the next hop must itself be a valid chain level", () => {
  it("an UNCONSTRAINED effectiveScope can be fed straight back in as the next hop's chain level", () => {
    const first = evaluate(baseInput());
    expect(first.decision).toBe("Allow");
    // The exact operation the delegation executor performs.
    const second = evaluate(baseInput({ chain: [agentVersionScope(), first.effectiveScope!], depth: 1 }));
    expect(second.denyReason).toBeUndefined();
    expect(second.decision).toBe("Allow");
  });

  it("omits `minRequiredTier` when it is at the lattice top, rather than emitting an out-of-schema null", () => {
    const result = evaluate(baseInput());
    expect(result.effectiveScope).toBeDefined();
    expect("minRequiredTier" in result.effectiveScope!).toBe(false);
  });

  it("still CARRIES a real `minRequiredTier` when one was declared — omission is only for the top", () => {
    const result = evaluate(baseInput({ chain: [agentVersionScope({ minRequiredTier: "Tier2" })] }));
    expect(result.effectiveScope?.minRequiredTier).toBe("Tier2");
    // …and it survives the round trip, still raising the floor on the next hop.
    const next = evaluate(
      baseInput({
        chain: [agentVersionScope(), result.effectiveScope!],
        depth: 1,
        requested: { kind: "ToolCall", toolId: uuid(), toolApprovalTier: "Tier1" },
      }),
    );
    expect(next.decision).toBe("Allow");
    expect(next.requiredTier).toBe("Tier2");
  });

  it("a THREE-hop round trip keeps narrowing and never re-widens", () => {
    const toolA = uuid();
    const toolB = uuid();
    const hop1 = evaluate(baseInput({ chain: [agentVersionScope({ toolIds: [toolA, toolB] })] }));
    const hop2 = evaluate(baseInput({ chain: [agentVersionScope(), hop1.effectiveScope!, teamMemberScope({ toolIds: [toolA] })], depth: 1 }));
    expect(hop2.effectiveScope?.toolIds).toEqual([toolA]);
    // A third hop declaring '*' cannot widen back to [toolA, toolB].
    const hop3 = evaluate(baseInput({ chain: [agentVersionScope(), hop2.effectiveScope!, teamMemberScope({ toolIds: "*" })], depth: 2 }));
    expect(hop3.effectiveScope?.toolIds).toEqual([toolA]);
  });
});
