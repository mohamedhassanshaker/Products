import type {
  ApprovalTierValue,
  ChannelTypeValue,
  EnvironmentValue,
  PermissionCondition,
  PermissionEffectValue,
  PermissionResolution,
} from "@nextbot/contracts";
import { evaluateExpression } from "./expression-evaluator.js";

export interface ResolverTool {
  id: string;
  /**
   * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-01, LLD §14.7.1) —
   * `null` for an `AgentAsTool` catalog entry (a specialist agent version
   * registered for delegation), which has no MCP connector behind it by
   * construction. See `resolvePermission`'s own doc for exactly which rules that
   * skips and which still apply verbatim.
   */
  connectorId: string | null;
  status: "Active" | "Disabled" | "Error" | "Removed";
  visibleToAgent: boolean;
  circuitState: "Closed" | "Open" | "HalfOpen";
  approvalTier: ApprovalTierValue;
  /** Phase 17 (client-feedback-batch capability-group enforcement) — FK to
   * `capability_group`, `null` when this tool has never been assigned one. See
   * `ResolverContext.allowedCapabilityGroupIds`'s doc for how the two interact. */
  capabilityGroupId: string | null;
}

export interface ResolverConnector {
  id: string;
  status: "Connected" | "Degraded" | "Offline";
  circuitState: "Closed" | "Open" | "HalfOpen";
  backendType: string;
}

export interface ResolverRule {
  id: string;
  scope: "Tool" | "Connector" | "BackendType";
  toolId: string | null;
  connectorId: string | null;
  backendType: string | null;
  ordinal: number;
  conditions: PermissionCondition;
  effect: PermissionEffectValue;
  requiredTier: ApprovalTierValue | null;
  enabled: boolean;
}

export interface ResolverContext {
  channelType?: ChannelTypeValue;
  roleId?: string;
  recognizedTask?: string;
  customerSegment?: string;
  environment?: EnvironmentValue;
  args?: Record<string, unknown>;
  /**
   * Phase 17 (client-feedback-batch capability-group enforcement) — the calling
   * agent version's `toolPolicy.capabilityGroups` (Design Studio picker, Phase 10),
   * already resolved from names to real tenant-scoped `capability_group.id`s by the
   * caller (`@nextbot/tool-registry`'s `resolveCapabilityGroupIdsByNames`).
   *
   * `undefined` (the default) means "no restriction configured for this call" —
   * every pre-Phase-17 caller (the admin Permissions screen's "simulate" panel,
   * existing unit/integration tests, any resolver call with no notion of an agent
   * version at all) keeps its exact previous behavior. A real array — including an
   * empty one — is a deliberate, active restriction: an empty array specifically
   * means the agent's configured group NAMES resolved to zero real groups (every
   * name was stale/deleted), which must deny every *grouped* tool, not silently
   * allow everything. An *ungrouped* tool (`ResolverTool.capabilityGroupId === null`)
   * is unaffected either way, matching the Design Studio's own shipped field hint
   * ("a tool with no group assigned is unaffected by this list") — this is a
   * deliberate product decision (see this phase's report), not an oversight.
   */
  allowedCapabilityGroupIds?: string[];
}

const TIER_RANK: Record<ApprovalTierValue, number> = { Tier1: 1, Tier2: 2, Tier3: 3 };

function conditionsMatch(conditions: PermissionCondition, ctx: ResolverContext): boolean {
  if (conditions.channelTypes && conditions.channelTypes.length > 0) {
    if (!ctx.channelType || !conditions.channelTypes.includes(ctx.channelType)) return false;
  }
  if (conditions.roleIds && conditions.roleIds.length > 0) {
    if (!ctx.roleId || !conditions.roleIds.includes(ctx.roleId)) return false;
  }
  if (conditions.recognizedTasks && conditions.recognizedTasks.length > 0) {
    if (!ctx.recognizedTask || !conditions.recognizedTasks.includes(ctx.recognizedTask)) return false;
  }
  if (conditions.customerSegments && conditions.customerSegments.length > 0) {
    if (!ctx.customerSegment || !conditions.customerSegments.includes(ctx.customerSegment)) return false;
  }
  if (conditions.environments && conditions.environments.length > 0) {
    if (!ctx.environment || !conditions.environments.includes(ctx.environment)) return false;
  }
  if (conditions.expression) {
    if (!evaluateExpression(conditions.expression, ctx.args)) return false;
  }
  return true;
}

/** Deterministic tie-break within a scope: `ordinal` ascending, then `id` ascending
 * (FR-AI-02) — guards against a non-deterministic DB row order ever changing which
 * rule "wins" when two rules share an ordinal. */
function sortRules(rules: ResolverRule[]): ResolverRule[] {
  return [...rules].sort((a, b) => (a.ordinal !== b.ordinal ? a.ordinal - b.ordinal : a.id.localeCompare(b.id)));
}

function firstMatch(rules: ResolverRule[], ctx: ResolverContext): ResolverRule | undefined {
  return sortRules(rules.filter((r) => r.enabled)).find((r) => conditionsMatch(r.conditions, ctx));
}

/**
 * The fail-closed permission resolver (LLD §3.6, FR-MCP-04 / FR-SEC-06). Pure
 * function — all state (tool/connector/rules) is passed in, no I/O here, so it can
 * be exhaustively unit-tested without a database.
 *
 * Precedence (steps 1-4 short-circuit to Deny regardless of rules; steps 5-7 are
 * evaluated in order, first match at each scope wins before falling through to the
 * next broader scope; step 8 is the fail-closed default):
 *   1. tool not Active or not visible to agent -> Deny (`tool_not_selectable`)
 *   2. tool or connector circuit Open           -> Deny (`circuit_open`)          [FR-MCP-08]
 *   3. connector Offline                        -> Deny (`connector_offline`)
 *   4. tool has a capability group AND the caller's `allowedCapabilityGroupIds` is
 *      configured (not `undefined`) but doesn't include it -> Deny
 *      (`capability_group_not_permitted`)                                        [Phase 17]
 *   5. scope=Tool rules, enabled, ordinal ASC    -> first match wins
 *   6. else scope=Connector rules                -> first match wins
 *   7. else scope=BackendType rules               -> first match wins
 *   8. else                                       -> Deny (`no_matching_rule`)     [fail-closed]
 *
 * **Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-01, LLD §14.7.1)**:
 * `connector` is `null` for an `AgentAsTool` entry. LLD §14.7.1's instruction is
 * exact — "the resolver's connector/circuit-breaker rules are skipped for
 * `AgentAsTool` (no connector); every other resolver rule applies verbatim." So a
 * null connector skips the connector half of step 2, all of step 3, and steps 6/7
 * (a Connector- or BackendType-scoped rule has, by definition, nothing to match
 * against). Every other step — including step 1's status/visibility gate, step 2's
 * TOOL-side circuit check, step 4's capability-group re-check, step 5's
 * Tool-scoped rules, and step 8's fail-closed default — applies unchanged. In
 * particular an `AgentAsTool` with no Tool-scoped rule is DENIED
 * (`no_matching_rule`), exactly like any other tool: nothing about delegation
 * opens a permissive path.
 */
export function resolvePermission(
  tool: ResolverTool,
  connector: ResolverConnector | null,
  rules: ResolverRule[],
  ctx: ResolverContext,
): PermissionResolution {
  if (tool.status !== "Active" || !tool.visibleToAgent) {
    return { effect: "Deny", tier: null, matchedRuleId: null, reason: "tool_not_selectable" };
  }
  if (tool.circuitState === "Open" || connector?.circuitState === "Open") {
    return { effect: "Deny", tier: null, matchedRuleId: null, reason: "circuit_open" };
  }
  if (connector?.status === "Offline") {
    return { effect: "Deny", tier: null, matchedRuleId: null, reason: "connector_offline" };
  }
  // Phase 17 (client-feedback-batch): the real, independent re-check backing
  // FR-AI-06's Agent Tool Registry capability-group restriction — never trusts that
  // whatever produced `tool` was already filtered by the agent's `toolPolicy`
  // (`tool-repository.ts`'s `listTools` pre-filter is a UX/efficiency convenience,
  // not the authorization boundary). Ungrouped tools (`capabilityGroupId === null`)
  // are always unaffected, matching the Design Studio's shipped field hint.
  if (
    ctx.allowedCapabilityGroupIds !== undefined &&
    tool.capabilityGroupId !== null &&
    !ctx.allowedCapabilityGroupIds.includes(tool.capabilityGroupId)
  ) {
    return { effect: "Deny", tier: null, matchedRuleId: null, reason: "capability_group_not_permitted" };
  }

  const toolRules = rules.filter((r) => r.scope === "Tool" && r.toolId === tool.id);
  // Both broader scopes are keyed off the connector; with no connector there is
  // nothing for them to match, so they contribute no candidates rather than
  // matching everything (Phase 14 — the fail-closed direction, as always here).
  const connectorRules = connector ? rules.filter((r) => r.scope === "Connector" && r.connectorId === connector.id) : [];
  const backendRules = connector ? rules.filter((r) => r.scope === "BackendType" && r.backendType === connector.backendType) : [];

  const matched = firstMatch(toolRules, ctx) ?? firstMatch(connectorRules, ctx) ?? firstMatch(backendRules, ctx);

  if (!matched) {
    return { effect: "Deny", tier: null, matchedRuleId: null, reason: "no_matching_rule" };
  }

  if (matched.effect === "Deny") {
    return { effect: "Deny", tier: null, matchedRuleId: matched.id, reason: "rule_deny" };
  }

  if (matched.effect === "Allow") {
    return { effect: "Allow", tier: tool.approvalTier, matchedRuleId: matched.id, reason: "rule_allow" };
  }

  // RequireApproval: tier is the MORE restrictive of the rule's required tier and the
  // tool's own approval tier (LLD: "tier = max(rule.required_tier, tool.approval_tier)").
  const ruleTier = matched.requiredTier as ApprovalTierValue;
  const tier = TIER_RANK[ruleTier] >= TIER_RANK[tool.approvalTier] ? ruleTier : tool.approvalTier;
  return { effect: "RequireApproval", tier, matchedRuleId: matched.id, reason: "rule_require_approval" };
}
