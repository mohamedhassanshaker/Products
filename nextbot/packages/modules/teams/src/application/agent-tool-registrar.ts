import type { TenantContext } from "@nextbot/db";
import type { ApprovalTierValue } from "@nextbot/contracts";
import { getVersionToolPolicy } from "@nextbot/agent-platform";
import { listTools, resolveCapabilityGroupIdsByNames, retireAgentAsTool, upsertAgentAsTool, type ToolRow } from "@nextbot/tool-registry";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-01, LLD §14.7.1) — creates
 * and retires the `AgentAsTool` `tool` row backing a team member.
 *
 * FR-ORC-01 in one sentence: "delegation reuses the existing per-tool
 * permission-rule engine, simulate preview, `agent_tool_config` visibility/
 * priority-weight controls, and Runtime Trace tool-call recording, rather than a
 * parallel invocation path." Everything this file does is in service of that — it
 * mints an ordinary catalog row and then gets out of the way. There is deliberately
 * no delegation-specific permission concept anywhere downstream of it.
 */

const TIER_RANK: Record<ApprovalTierValue, number> = { Tier1: 1, Tier2: 2, Tier3: 3 };

/** LLD §14.7.1's naming rule, in one place so the console, the trace viewer and the
 * Approval Queue all show the same string. */
export function agentToolName(definitionName: string): string {
  return `agent.${definitionName}`;
}

/**
 * **The tier-derivation rule, and why it is a checkable property rather than a
 * guess.** LLD §14.7.1: the `AgentAsTool`'s `approval_tier` defaults to "the
 * specialist's own highest-tier reachable tool (never lower)".
 *
 * Reachable is computed from the specialist version's OWN
 * `spec.toolPolicy.capabilityGroups` — the same restriction
 * `orchestration/turn-pipeline.ts` applies to that version at runtime and the same
 * one `permission-resolver.ts` independently re-checks — resolved through
 * `tool-registry`'s own `resolveCapabilityGroupIdsByNames`/`listTools`, never a
 * second notion of "which tools can this agent use".
 *
 * The direction of the rule matters: delegating to a specialist that can itself
 * issue a Tier-3 action is at least as consequential as issuing that action
 * directly, so the delegation must not be cheaper to authorise than the thing it
 * enables. A specialist with an empty/unrestricted policy is measured against every
 * tool it could actually select.
 *
 * @returns the highest `approval_tier` among the specialist's reachable, selectable
 *   tools, or `'Tier1'` when it can reach none.
 */
export async function deriveDelegationTierFloor(ctx: TenantContext, definitionVersionId: string): Promise<ApprovalTierValue> {
  const policy = await getVersionToolPolicy(ctx, definitionVersionId);
  const allowedCapabilityGroupIds =
    policy.capabilityGroups.length > 0 ? await resolveCapabilityGroupIdsByNames(ctx, policy.capabilityGroups) : undefined;

  const reachable = (await listTools(ctx, { allowedCapabilityGroupIds })).filter(
    // Only tools the specialist could actually select at runtime count. A Disabled
    // or agent-invisible tool cannot be reached, so inflating the delegation tier
    // for it would be a guess, not a property. `AgentAsTool` rows are excluded
    // because a specialist reaches those only through its OWN team membership, and
    // including them would make this derivation depend on itself.
    (t) => t.status === "Active" && t.visibleToAgent && t.kind !== "AgentAsTool",
  );

  return highestTier(reachable);
}

function highestTier(tools: ToolRow[]): ApprovalTierValue {
  let highest: ApprovalTierValue = "Tier1";
  for (const t of tools) if (TIER_RANK[t.approvalTier] > TIER_RANK[highest]) highest = t.approvalTier;
  return highest;
}

export interface RegisterAgentToolInput {
  definitionVersionId: string;
  /** The specialist's `agent_definition.name` — the tool is named
   * `agent.<definitionName>`. */
  definitionName: string;
  /** The `delegationTier` the team author declared for this member. The registered
   * tier is `max(authored, derivedFloor)` — an author may make delegation STRICTER
   * than the specialist's own reach, never laxer. */
  authoredDelegationTier: ApprovalTierValue;
  description: string;
}

export interface RegisterAgentToolResult {
  tool: ToolRow;
  /** The tier actually registered — surfaced so the team-version service can report
   * "we raised your Tier1 declaration to Tier3" instead of silently overriding it. */
  effectiveTier: ApprovalTierValue;
  derivedFloor: ApprovalTierValue;
}

/**
 * Registers (or re-activates) the catalog entry for one team member's pinned
 * specialist version.
 *
 * `rwClass` is `'Write'` unconditionally: a delegation can cause the specialist to
 * perform any action within its own scope, including a write, so classifying the
 * delegation itself as a read would understate it. This is the conservative
 * direction and matches how the tier floor is derived.
 */
export async function registerAgentAsTool(ctx: TenantContext, input: RegisterAgentToolInput): Promise<RegisterAgentToolResult> {
  const derivedFloor = await deriveDelegationTierFloor(ctx, input.definitionVersionId);
  const effectiveTier = TIER_RANK[input.authoredDelegationTier] > TIER_RANK[derivedFloor] ? input.authoredDelegationTier : derivedFloor;

  const tool = await upsertAgentAsTool(ctx, {
    agentDefinitionVersionId: input.definitionVersionId,
    name: agentToolName(input.definitionName),
    descriptionSource: input.description,
    rwClass: "Write",
    approvalTier: effectiveTier,
  });

  return { tool, effectiveTier, derivedFloor };
}

/** Retires the catalog entry when a member is removed. Soft (`status='Disabled'`,
 * `visible_to_agent=false`) so the tool's own `tool_call` history — and any
 * in-flight Approval Queue entry referencing it — stays referentially intact, which
 * is exactly how this catalog already treats a withdrawn MCP tool. */
export async function retireAgentTool(ctx: TenantContext, toolId: string): Promise<void> {
  await retireAgentAsTool(ctx, toolId);
}
