import { describe, expect, it } from "vitest";
import { resolvePermission, type ResolverConnector, type ResolverRule, type ResolverTool } from "./permission-resolver.js";

const baseTool: ResolverTool = {
  id: "tool-1",
  connectorId: "conn-1",
  status: "Active",
  visibleToAgent: true,
  circuitState: "Closed",
  approvalTier: "Tier1",
  capabilityGroupId: null,
};

const baseConnector: ResolverConnector = {
  id: "conn-1",
  status: "Connected",
  circuitState: "Closed",
  backendType: "Ticketing",
};

const allowToolRule: ResolverRule = {
  id: "rule-a",
  scope: "Tool",
  toolId: "tool-1",
  connectorId: null,
  backendType: null,
  ordinal: 0,
  conditions: {},
  effect: "Allow",
  requiredTier: null,
  enabled: true,
};

describe("resolvePermission (LLD §3.6 algorithm)", () => {
  it("step 1: Denies when tool.status != Active", () => {
    const result = resolvePermission({ ...baseTool, status: "Disabled" }, baseConnector, [allowToolRule], {});
    expect(result).toEqual({ effect: "Deny", tier: null, matchedRuleId: null, reason: "tool_not_selectable" });
  });

  it("step 1: Denies when tool.visibleToAgent = false", () => {
    const result = resolvePermission({ ...baseTool, visibleToAgent: false }, baseConnector, [allowToolRule], {});
    expect(result.reason).toBe("tool_not_selectable");
  });

  it("step 2: Denies when tool.circuitState = Open (FR-MCP-08)", () => {
    const result = resolvePermission({ ...baseTool, circuitState: "Open" }, baseConnector, [allowToolRule], {});
    expect(result).toEqual({ effect: "Deny", tier: null, matchedRuleId: null, reason: "circuit_open" });
  });

  it("step 2: Denies when connector.circuitState = Open", () => {
    const result = resolvePermission(baseTool, { ...baseConnector, circuitState: "Open" }, [allowToolRule], {});
    expect(result.reason).toBe("circuit_open");
  });

  it("step 3: Denies when connector.status = Offline", () => {
    const result = resolvePermission(baseTool, { ...baseConnector, status: "Offline" }, [allowToolRule], {});
    expect(result).toEqual({ effect: "Deny", tier: null, matchedRuleId: null, reason: "connector_offline" });
  });

  it("step 4: a matching Tool-scope rule wins even when a Connector-scope rule would also match", () => {
    const connectorDeny: ResolverRule = { ...allowToolRule, id: "rule-conn", scope: "Connector", toolId: null, connectorId: "conn-1", effect: "Deny" };
    const result = resolvePermission(baseTool, baseConnector, [connectorDeny, allowToolRule], {});
    expect(result).toEqual({ effect: "Allow", tier: "Tier1", matchedRuleId: "rule-a", reason: "rule_allow" });
  });

  it("step 4: Tool-scope rules evaluate in ordinal-ascending order, first match wins", () => {
    const first: ResolverRule = { ...allowToolRule, id: "rule-1", ordinal: 1, effect: "Deny" };
    const second: ResolverRule = { ...allowToolRule, id: "rule-2", ordinal: 2, effect: "Allow" };
    const result = resolvePermission(baseTool, baseConnector, [second, first], {});
    expect(result.matchedRuleId).toBe("rule-1");
    expect(result.effect).toBe("Deny");
  });

  it("step 5: falls through to Connector-scope when no Tool-scope rule matches", () => {
    const connectorRule: ResolverRule = { ...allowToolRule, id: "rule-conn", scope: "Connector", toolId: null, connectorId: "conn-1" };
    const result = resolvePermission(baseTool, baseConnector, [connectorRule], {});
    expect(result.matchedRuleId).toBe("rule-conn");
  });

  it("step 6: falls through to BackendType-scope when no Tool/Connector rule matches", () => {
    const backendRule: ResolverRule = { ...allowToolRule, id: "rule-bt", scope: "BackendType", toolId: null, backendType: "Ticketing" };
    const result = resolvePermission(baseTool, baseConnector, [backendRule], {});
    expect(result.matchedRuleId).toBe("rule-bt");
  });

  it("step 7: fail-closed Deny when no rule exists at any scope", () => {
    const result = resolvePermission(baseTool, baseConnector, [], {});
    expect(result).toEqual({ effect: "Deny", tier: null, matchedRuleId: null, reason: "no_matching_rule" });
  });

  it("step 7: fail-closed Deny when rules exist but none match conditions", () => {
    const conditional: ResolverRule = { ...allowToolRule, conditions: { channelTypes: ["WhatsApp"] } };
    const result = resolvePermission(baseTool, baseConnector, [conditional], { channelType: "WebWidget" });
    expect(result.reason).toBe("no_matching_rule");
  });

  it("a disabled rule never matches even if its conditions would", () => {
    const disabled: ResolverRule = { ...allowToolRule, enabled: false };
    const result = resolvePermission(baseTool, baseConnector, [disabled], {});
    expect(result.reason).toBe("no_matching_rule");
  });

  it("effect=Allow sets tier = tool.approvalTier", () => {
    const result = resolvePermission({ ...baseTool, approvalTier: "Tier2" }, baseConnector, [allowToolRule], {});
    expect(result).toEqual({ effect: "Allow", tier: "Tier2", matchedRuleId: "rule-a", reason: "rule_allow" });
  });

  it("effect=Deny (explicit rule) sets tier = null", () => {
    const denyRule: ResolverRule = { ...allowToolRule, effect: "Deny" };
    const result = resolvePermission(baseTool, baseConnector, [denyRule], {});
    expect(result).toEqual({ effect: "Deny", tier: null, matchedRuleId: "rule-a", reason: "rule_deny" });
  });

  it("effect=RequireApproval: tier = the rule's required tier when it's stricter than the tool's own tier", () => {
    const rule: ResolverRule = { ...allowToolRule, effect: "RequireApproval", requiredTier: "Tier3" };
    const result = resolvePermission({ ...baseTool, approvalTier: "Tier1" }, baseConnector, [rule], {});
    expect(result).toEqual({ effect: "RequireApproval", tier: "Tier3", matchedRuleId: "rule-a", reason: "rule_require_approval" });
  });

  it("effect=RequireApproval: tier = the tool's own tier when it's stricter than the rule's required tier", () => {
    const rule: ResolverRule = { ...allowToolRule, effect: "RequireApproval", requiredTier: "Tier1" };
    const result = resolvePermission({ ...baseTool, approvalTier: "Tier3" }, baseConnector, [rule], {});
    expect(result.tier).toBe("Tier3");
  });

  it("condition matching: channelTypes restricts to listed channels", () => {
    const rule: ResolverRule = { ...allowToolRule, conditions: { channelTypes: ["WhatsApp"] } };
    expect(resolvePermission(baseTool, baseConnector, [rule], { channelType: "WhatsApp" }).effect).toBe("Allow");
    expect(resolvePermission(baseTool, baseConnector, [rule], { channelType: "WebWidget" }).reason).toBe("no_matching_rule");
  });

  it("condition matching: roleIds restricts to listed roles", () => {
    const rule: ResolverRule = { ...allowToolRule, conditions: { roleIds: ["role-a"] } };
    expect(resolvePermission(baseTool, baseConnector, [rule], { roleId: "role-a" }).effect).toBe("Allow");
    expect(resolvePermission(baseTool, baseConnector, [rule], { roleId: "role-b" }).reason).toBe("no_matching_rule");
  });

  it("condition matching: expression args.amount > 5000", () => {
    const rule: ResolverRule = { ...allowToolRule, effect: "RequireApproval", requiredTier: "Tier2", conditions: { expression: "args.amount > 5000" } };
    expect(resolvePermission(baseTool, baseConnector, [rule], { args: { amount: 6000 } }).effect).toBe("RequireApproval");
    expect(resolvePermission(baseTool, baseConnector, [rule], { args: { amount: 100 } }).reason).toBe("no_matching_rule");
  });

  it("step 4 (Phase 17): Denies a grouped tool when its group isn't in the caller's allowed list", () => {
    const grouped: ResolverTool = { ...baseTool, capabilityGroupId: "group-billing" };
    const result = resolvePermission(grouped, baseConnector, [allowToolRule], { allowedCapabilityGroupIds: ["group-orders"] });
    expect(result).toEqual({ effect: "Deny", tier: null, matchedRuleId: null, reason: "capability_group_not_permitted" });
  });

  it("step 4 (Phase 17): Allows a grouped tool whose group IS in the caller's allowed list (falls through to normal rule matching)", () => {
    const grouped: ResolverTool = { ...baseTool, capabilityGroupId: "group-billing" };
    const result = resolvePermission(grouped, baseConnector, [allowToolRule], { allowedCapabilityGroupIds: ["group-billing"] });
    expect(result).toEqual({ effect: "Allow", tier: "Tier1", matchedRuleId: "rule-a", reason: "rule_allow" });
  });

  it("step 4 (Phase 17): an ungrouped tool (capabilityGroupId: null) is unaffected by an active restriction", () => {
    const result = resolvePermission(baseTool, baseConnector, [allowToolRule], { allowedCapabilityGroupIds: ["group-billing"] });
    expect(result.effect).toBe("Allow");
  });

  it("step 4 (Phase 17): a grouped tool is Denied when the caller's allowed-group list is a real, active, but EMPTY restriction (every configured name was stale/deleted)", () => {
    const grouped: ResolverTool = { ...baseTool, capabilityGroupId: "group-billing" };
    const result = resolvePermission(grouped, baseConnector, [allowToolRule], { allowedCapabilityGroupIds: [] });
    expect(result).toEqual({ effect: "Deny", tier: null, matchedRuleId: null, reason: "capability_group_not_permitted" });
  });

  it("step 4 (Phase 17): `allowedCapabilityGroupIds: undefined` (the default) applies no restriction at all, even for a grouped tool", () => {
    const grouped: ResolverTool = { ...baseTool, capabilityGroupId: "group-billing" };
    const result = resolvePermission(grouped, baseConnector, [allowToolRule], {});
    expect(result.effect).toBe("Allow");
  });

  it("tie-break determinism: same ordinal, rule id ascending wins deterministically regardless of input array order", () => {
    const ruleZ: ResolverRule = { ...allowToolRule, id: "rule-z", ordinal: 5, effect: "Deny" };
    const ruleA: ResolverRule = { ...allowToolRule, id: "rule-a-tie", ordinal: 5, effect: "Allow" };
    const result1 = resolvePermission(baseTool, baseConnector, [ruleZ, ruleA], {});
    const result2 = resolvePermission(baseTool, baseConnector, [ruleA, ruleZ], {});
    expect(result1.matchedRuleId).toBe("rule-a-tie");
    expect(result2.matchedRuleId).toBe("rule-a-tie");
  });
});
