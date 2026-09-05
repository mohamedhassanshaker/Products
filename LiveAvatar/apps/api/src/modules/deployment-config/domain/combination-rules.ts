import { messageForCode } from '@liveavatar/contracts';
import type { GraphNode } from '@liveavatar/contracts';
import type { ProviderCredentialRecord, ProviderDefinitionRecord } from '../../providers';
import type { PartialAgentConfig } from './agent-config';
import { findLlmNodes } from './agent-config';
import { computeCriticalPath } from './critical-path';
import { computeBasePromptCost, type AttachedItemDescription } from './prompt-cost';
import type { ConfigError } from './errors';

/**
 * Phase 9 (BL-035): the primary/fallback LLM legs now live inside
 * `reasoning.graph`'s `llm`-type node(s) instead of a flat `llm.primary`/
 * `llm.fallback` pair. A config may in principle carry more than one `llm`
 * node (e.g. a Router branch with its own LLM), but this phase's rules
 * still only reason about "the" primary/fallback the way the old flat
 * schema did — the **first** `llm` node in `reasoning.graph` is treated as
 * the primary leg for these checks (same one `SaveConfigUseCase` uses for
 * the denormalized provider columns). Validating every LLM node
 * individually is a natural Phase-11+ extension once multi-LLM-node graphs
 * are common (Router branches, Parallel), not required for this phase's
 * exit condition.
 */
function primaryLlmLeg(config: PartialAgentConfig): { provider?: string; credential_ref?: string; model?: string } | undefined {
  const [first] = findLlmNodes(config.reasoning);
  return first;
}

function fallbackLlmLeg(config: PartialAgentConfig): { provider?: string; credential_ref?: string; model?: string } | undefined {
  const [first] = findLlmNodes(config.reasoning);
  return first?.fallback;
}

/** Everything a Gate-B rule needs, loaded once per validate/save call (LLD §8.2). */
export interface ValidationContext {
  config: PartialAgentConfig;
  catalog: Map<string, ProviderDefinitionRecord>;
  credentialsByProviderKey: Map<string, ProviderCredentialRecord[]>;
  /** `true` when every referenced `agent.tools[].api_ref` exists for this tenant. */
  knownToolRefs: Set<string>;
  /**
   * Phase 13 (BL-049/050/051) — `ToolDefinition.description` by `api_ref`,
   * for V-11's tools-term token cost (the client-side Phase-8 banner has
   * this from its own separate `GET /tenants/:id/tools` fetch; the backend
   * estimator needs it threaded through explicitly). Optional for the same
   * "no existing test literal breaks" reason `knowledgeSources` documents.
   * Phase 16 (BL-063) widens the value to also carry `argsSchema` — V-11's
   * own rule text says "tool *schemas*," not just descriptions (see
   * `prompt-cost.ts`'s doc comment).
   */
  toolDescriptionsByApiRef?: Map<string, { description: string | null; argsSchema: Record<string, unknown> }>;
  /**
   * Phase 12a/12b — optional so no existing test-constructed `ValidationContext`
   * literal breaks by omitting it. See `knowledgeSourceNotStaleRule` below for
   * why this is not yet populated/wired into the real save/validate pipeline.
   */
  knowledgeSources?: { id: string; name: string; isStale: boolean }[];
  /**
   * Phase 13 (BL-049/050/051) — every *published* skill for this tenant,
   * keyed by id, for V-12's existence check and V-11's skills-term cost.
   * Optional for the same "no existing test literal breaks" reason
   * `knowledgeSources` above already documents.
   */
  publishedSkills?: Map<string, { name: string; description: string; hitlGateId?: string | null }>;
  /**
   * Phase 14 (BL-057, V-6) — every `ToolDefinition.consequential === true`
   * api_ref for this tenant. Optional for the same "no existing test
   * literal breaks" reason `knowledgeSources` above documents.
   */
  consequentialToolApiRefs?: Set<string>;
  /** V-6 — `ToolDefinition.autonomousUseAckText` by `api_ref`, for tools with no gate attached. */
  toolAutonomousAckByApiRef?: Map<string, string | null>;
  /** V-6/V-7 — the `HitlGate.id` attached to a tool (`attachmentKind: 'tool'`), by `api_ref`, if any. */
  toolGateIdByApiRef?: Map<string, string>;
  /**
   * V-7 — every `HitlGate` reachable from this config (referenced by a
   * `hitl`-type graph node, a gated consequential tool, or a gated skill),
   * keyed by id. `hasReviewerCoverage` is pre-resolved by the caller (≥1
   * reviewer-group member AND ≥1 notification channel, on the gate or its
   * reviewer group) — this file stays a pure function over primitives, same
   * discipline as every other Gate-B rule here.
   */
  hitlGatesById?: Map<string, { gateType: string; hasReviewerCoverage: boolean }>;
  /**
   * Phase 15 (BL-058, V-3/R-G6) — the tenant this config itself belongs to.
   * Needed only for `subagentSelfReferenceRule`'s "cannot delegate to your
   * own tenant" check. Optional for the same "no existing test literal
   * breaks" reason every other field here documents.
   */
  tenantId?: string;
  /**
   * V-3 — every `target_tenant_id` a `subagent`-type node in this config
   * references, resolved once by the caller (mirrors `publishedSkills`'s
   * own "pre-loaded map, pure function over primitives" shape).
   * `published: false` means the target tenant has no published config at
   * all (existence check); `hasSubAgentNode: true` means that target's own
   * published config itself contains a `subagent`-type node — one hop past
   * this config's own delegation would then be a second delegation, so a
   * further hop from *that* would exceed R-G6's 2-level ceiling (the caller
   * resolves this one hop transitively — see `validate-config.use-case.ts`).
   */
  subAgentTargetsById?: Map<string, { published: boolean; hasSubAgentNode: boolean }>;
}

/** One combination rule — a small pure function (LLD §8.2). */
type Rule = (ctx: ValidationContext) => ConfigError[];

/** FR-PROVIDER-5 — every required layer must have a provider selected. */
const completenessRule: Rule = (ctx) => {
  const errors: ConfigError[] = [];
  const layers: { name: string; present: boolean }[] = [
    { name: 'transport', present: Boolean(ctx.config.transport?.provider) },
    { name: 'stt', present: Boolean(ctx.config.stt?.provider) },
    { name: 'reasoning.llm', present: Boolean(primaryLlmLeg(ctx.config)?.provider) },
    { name: 'tts', present: Boolean(ctx.config.tts?.provider) },
    { name: 'avatar', present: Boolean(ctx.config.avatar?.provider) },
  ];
  for (const layer of layers) {
    if (!layer.present) {
      errors.push({
        code: 'CONFIG_INCOMPLETE',
        layer: layer.name,
        message: `Select a provider for ${layer.name}.`,
      });
    }
  }
  return errors;
};

/** FR-PROVIDER-5 — v1 supports only LiveKit transport (schema already constrains this; defensive). */
const transportSupportedRule: Rule = (ctx) => {
  const provider = ctx.config.transport?.provider;
  if (provider && provider !== 'livekit') {
    return [{ code: 'CONFIG_TRANSPORT_UNSUPPORTED', layer: 'transport', message: messageForCode('CONFIG_TRANSPORT_UNSUPPORTED') }];
  }
  return [];
};

/** Every layer with a selected provider that is disabled in the catalog. */
const providerEnabledRule: Rule = (ctx) => {
  const errors: ConfigError[] = [];
  const selections: { layer: string; key?: string }[] = [
    { layer: 'transport', key: ctx.config.transport?.provider },
    { layer: 'stt', key: ctx.config.stt?.provider },
    { layer: 'reasoning.llm', key: primaryLlmLeg(ctx.config)?.provider },
    { layer: 'reasoning.llm.fallback', key: fallbackLlmLeg(ctx.config)?.provider },
    { layer: 'tts', key: ctx.config.tts?.provider },
    { layer: 'avatar', key: ctx.config.avatar?.provider },
  ];
  for (const sel of selections) {
    if (!sel.key) {
      continue;
    }
    const def = ctx.catalog.get(sel.key);
    if (def && !def.enabled) {
      errors.push({
        code: 'CONFIG_PROVIDER_DISABLED',
        layer: sel.layer,
        message: `${sel.key} is disabled on this platform.`,
      });
    }
  }
  return errors;
};

/** Every layer whose provider `requiresCredential` must have a tenant `ProviderCredential` row. */
const credentialExistsRule: Rule = (ctx) => {
  const errors: ConfigError[] = [];
  const selections: { layer: string; key?: string }[] = [
    { layer: 'transport', key: ctx.config.transport?.provider },
    { layer: 'stt', key: ctx.config.stt?.provider },
    { layer: 'reasoning.llm', key: primaryLlmLeg(ctx.config)?.provider },
    { layer: 'reasoning.llm.fallback', key: fallbackLlmLeg(ctx.config)?.provider },
    { layer: 'tts', key: ctx.config.tts?.provider },
    { layer: 'avatar', key: ctx.config.avatar?.provider },
  ];
  for (const sel of selections) {
    if (!sel.key) {
      continue;
    }
    const def = ctx.catalog.get(sel.key);
    if (!def?.requiresCredential) {
      continue;
    }
    const creds = ctx.credentialsByProviderKey.get(sel.key) ?? [];
    if (creds.length === 0) {
      errors.push({
        code: 'CONFIG_CREDENTIAL_MISSING',
        layer: sel.layer,
        message: `Add an endpoint and credential ref for ${sel.key} in Provider Registry.`,
      });
    }
  }
  return errors;
};

/** FR-PROVIDER-5 — fallback LLM must differ from primary (provider or model). */
const fallbackDiffersRule: Rule = (ctx) => {
  const primary = primaryLlmLeg(ctx.config);
  const fallback = fallbackLlmLeg(ctx.config);
  if (primary?.provider && fallback?.provider) {
    if (primary.provider === fallback.provider && primary.model === fallback.model) {
      return [
        { code: 'CONFIG_FALLBACK_IDENTICAL', layer: 'reasoning.llm.fallback', message: messageForCode('CONFIG_FALLBACK_IDENTICAL') },
      ];
    }
  }
  return [];
};

/** FR-PRIV-* — residency `none` cannot pair with a remote LLM. */
const residencyBlocksRemoteLlmRule: Rule = (ctx) => {
  const mode = ctx.config.privacy?.send_to_remote_llm;
  const primaryKey = primaryLlmLeg(ctx.config)?.provider;
  if (mode === 'none' && primaryKey) {
    const def = ctx.catalog.get(primaryKey);
    if (def?.hosting === 'remote') {
      return [
        {
          code: 'CONFIG_RESIDENCY_BLOCKS_LLM',
          layer: 'privacy',
          message: messageForCode('CONFIG_RESIDENCY_BLOCKS_LLM'),
        },
      ];
    }
  }
  return [];
};

/**
 * Every `agent.tools[].api_ref` (always-available tools) **and** every
 * `tool`-type graph node's `api_ref` (Phase 9, BL-035) must reference a
 * known tenant `ToolDefinition` — the graph node case is the same check
 * Phase 13's Skill tool-attachment and Phase 9's own graph Tool node both
 * need, so it lives here rather than being duplicated per attachment route.
 */
const toolRefsKnownRule: Rule = (ctx) => {
  const tools = ctx.config.agent?.tools ?? [];
  const errors: ConfigError[] = [];
  for (const tool of tools) {
    if (!ctx.knownToolRefs.has(tool.api_ref)) {
      errors.push({
        code: 'CONFIG_TOOL_UNKNOWN',
        layer: 'agent.tools',
        field: tool.api_ref,
        message: `Unknown tool api_ref '${tool.api_ref}'.`,
      });
    }
  }
  const graphToolNodes = (ctx.config.reasoning?.graph ?? []).filter(
    (n): n is Extract<NonNullable<typeof ctx.config.reasoning>['graph'][number], { type: 'tool' }> => n.type === 'tool',
  );
  for (const node of graphToolNodes) {
    if (!ctx.knownToolRefs.has(node.api_ref)) {
      errors.push({
        code: 'CONFIG_TOOL_UNKNOWN',
        layer: 'reasoning.graph',
        field: node.id,
        message: `Unknown tool api_ref '${node.api_ref}'.`,
      });
    }
  }
  return errors;
};

/**
 * V-1 (Phase 10, BL-040) — the foreground critical path must not exceed the
 * declared `turn_budget_ms` (R-G3/R-G10). Blocks **publish** only, exactly
 * like every other Gate B rule here — the multi-environment descope
 * (`ARCHITECTURE_NOTES.md` §0.2) means "publish" is already the only real
 * production-enforcement point in this codebase, so no extra
 * environment-conditional branching is needed to honor BL-040's "blocks
 * production publish only" text.
 */
const criticalPathWithinBudgetRule: Rule = (ctx) => {
  const reasoning = ctx.config.reasoning;
  if (!reasoning?.graph) {
    return [];
  }
  const report = computeCriticalPath(reasoning);
  if (!report.over_budget) {
    return [];
  }
  return [
    {
      code: 'CONFIG_CRITICAL_PATH_EXCEEDS_BUDGET',
      layer: 'reasoning.turn_budget_ms',
      message: `The critical path (${report.critical_path_ms}ms) exceeds the turn budget (${report.turn_budget_ms}ms).`,
    },
  ];
};

/**
 * V-9 (Phase 12a/12b, `docs/v2/BACKLOG.md`/`UX_SCOPE.md`: "warn unless
 * referenced by a published-path skill") — **now live and registered**.
 * 12a shipped this as a tenant-wide warning (every stale source a tenant
 * owned) because nothing yet named which sources a Retrieve node actually
 * used; now that `RetrieveNode.source_refs` is real (Phase 12b), the
 * warning is rescoped to only the sources a live `retrieve`-type node
 * actually references. Skills don't exist until Phase 13, so — per the
 * task brief — every live reference is treated as needing the warning
 * today; Phase 13 should refine this once a "published-path skill"
 * exception has something to check against.
 *
 * Attaches with `field: <node.id>` (the *referencing* node), not
 * `field: <source.id>` — `reasoning.store.ts`'s `errorsByNode()` derives a
 * node-card id from a `layer: 'reasoning.graph'` error's `field`, so
 * attaching to the source id would make this warning attach to nothing and
 * silently vanish (neither shown on a node card, nor in the global banner,
 * since `reasoning.graph`-layer errors are unconditionally excluded from
 * the global list — see that store's own doc comment).
 *
 * `severity: 'warning'` (Phase 12b's one-phase-early addition to
 * `ConfigError`, see the plan doc) is what makes this genuinely
 * non-blocking — `ValidateConfigUseCase.execute()`'s `valid` and
 * `SaveConfigUseCase`'s publish gate both filter `severity !== 'warning'`
 * before deciding whether to block.
 */
export const knowledgeSourceNotStaleRule: Rule = (ctx) => {
  const staleById = new Map((ctx.knowledgeSources ?? []).filter((s) => s.isStale).map((s) => [s.id, s]));
  if (staleById.size === 0) {
    return [];
  }
  const retrieveNodes = (ctx.config.reasoning?.graph ?? []).filter(
    (n): n is Extract<GraphNode, { type: 'retrieve' }> => n.type === 'retrieve',
  );
  const errors: ConfigError[] = [];
  for (const node of retrieveNodes) {
    for (const sourceId of node.source_refs) {
      const source = staleById.get(sourceId);
      if (!source) {
        continue;
      }
      errors.push({
        code: 'KNOWLEDGE_SOURCE_STALE',
        layer: 'reasoning.graph',
        field: node.id,
        message: `Knowledge source '${source.name}' has not been re-indexed since its configuration changed.`,
        severity: 'warning',
      });
    }
  }
  return errors;
};

/**
 * V-12 (Phase 13, BL-049/050/051) — every `skills[].id` (agent-level
 * attach list) **and** every `skill`-type graph node's `skill_id` must
 * reference a known, **published** tenant `Skill` — structurally identical
 * to `toolRefsKnownRule` above (per `ARCHITECTURE_NOTES.md` §5.4's own
 * instruction to mirror it). "Enabled" for v1 means "the tenant-level
 * `Skill`/`SkillVersion` exists and is published" — the multi-environment
 * descope (`ARCHITECTURE_NOTES.md` §0.2) means `environments[]` never
 * changes this check's outcome.
 */
const skillRefsKnownAndEnabledRule: Rule = (ctx) => {
  const known = ctx.publishedSkills ?? new Map();
  const errors: ConfigError[] = [];
  for (const ref of ctx.config.skills ?? []) {
    if (!known.has(ref.id)) {
      errors.push({
        code: 'CONFIG_SKILL_UNKNOWN',
        layer: 'skills',
        field: ref.id,
        message: `Unknown or unpublished skill '${ref.id}'.`,
      });
    }
  }
  const graphSkillNodes = (ctx.config.reasoning?.graph ?? []).filter(
    (n): n is Extract<GraphNode, { type: 'skill' }> => n.type === 'skill',
  );
  for (const node of graphSkillNodes) {
    if (!known.has(node.skill_id)) {
      errors.push({
        code: 'CONFIG_SKILL_UNKNOWN',
        layer: 'reasoning.graph',
        field: node.id,
        message: `Unknown or unpublished skill '${node.skill_id}'.`,
      });
    }
  }
  return errors;
};

/**
 * V-11 (Phase 13, BL-049/050/051; `ARCHITECTURE_NOTES.md` §7 —
 * "warning-class") — the whole base prompt (core instructions + attached
 * tool descriptions+schemas + attached skill descriptions) must not exceed
 * `DEFAULT_BASE_PROMPT_TOKEN_CEILING` (`domain/prompt-cost.ts`). Never
 * blocks publish (`severity: 'warning'`) — same non-blocking treatment
 * `knowledgeSourceNotStaleRule` above already established for V-9.
 */
const basePromptCostWithinCeilingRule: Rule = (ctx) => {
  const enabledApiRefs = new Set((ctx.config.agent?.tools ?? []).filter((t) => t.enabled !== false).map((t) => t.api_ref));
  const toolDescriptions: AttachedItemDescription[] = (ctx.config.agent?.tools ?? [])
    .filter((t) => enabledApiRefs.has(t.api_ref))
    .map((t) => {
      const resolved = ctx.toolDescriptionsByApiRef?.get(t.api_ref);
      return { name: t.name, description: resolved?.description ?? null, argsSchema: resolved?.argsSchema };
    });
  const skillDescriptions: AttachedItemDescription[] = (ctx.config.skills ?? [])
    .map((ref) => ctx.publishedSkills?.get(ref.id))
    .filter((s): s is { name: string; description: string } => Boolean(s))
    .map((s) => ({ name: s.name, description: s.description }));

  const breakdown = computeBasePromptCost(ctx.config.agent?.system_prompt, toolDescriptions, skillDescriptions);
  if (!breakdown.over_ceiling) {
    return [];
  }
  return [
    {
      code: 'CONFIG_BASE_PROMPT_COST_HIGH',
      layer: 'agent.system_prompt',
      message: `Base prompt (~${breakdown.total_tokens} tokens) exceeds the recommended ceiling (~${breakdown.ceiling_tokens} tokens).`,
      severity: 'warning',
    },
  ];
};

/**
 * V-6 (Phase 14, BL-057) — every consequential tool actually referenced by
 * this config (`agent.tools[]` or a `tool`-type graph node — same two
 * sources `toolRefsKnownRule` above already checks) must have a `HitlGate`
 * attached, or a written autonomous-use acknowledgement on the tool itself.
 * An unreferenced consequential tool sitting unused in the registry is not
 * this rule's concern (mirrors every other reference-scoped rule here).
 */
const consequentialToolGatedOrAckedRule: Rule = (ctx) => {
  const consequential = ctx.consequentialToolApiRefs ?? new Set<string>();
  if (consequential.size === 0) {
    return [];
  }
  const referencedApiRefs = new Set<string>();
  for (const tool of ctx.config.agent?.tools ?? []) {
    referencedApiRefs.add(tool.api_ref);
  }
  for (const node of ctx.config.reasoning?.graph ?? []) {
    if (node.type === 'tool') {
      referencedApiRefs.add(node.api_ref);
    }
  }
  const errors: ConfigError[] = [];
  for (const ref of referencedApiRefs) {
    if (!consequential.has(ref)) {
      continue;
    }
    const hasGate = Boolean(ctx.toolGateIdByApiRef?.get(ref));
    const hasAck = Boolean(ctx.toolAutonomousAckByApiRef?.get(ref)?.trim());
    if (!hasGate && !hasAck) {
      errors.push({
        code: 'CONFIG_CONSEQUENTIAL_TOOL_UNGATED',
        layer: 'agent.tools',
        field: ref,
        message: `Consequential tool '${ref}' has no HITL gate and no written autonomous-use acknowledgement.`,
      });
    }
  }
  return errors;
};

/**
 * Every `hitl`-type graph node's `gate_id` must reference a known `HitlGate`
 * — structurally identical to `toolRefsKnownRule`/`skillRefsKnownAndEnabledRule`.
 */
const hitlGateRefsKnownRule: Rule = (ctx) => {
  const known = ctx.hitlGatesById ?? new Map();
  const errors: ConfigError[] = [];
  const graphHitlNodes = (ctx.config.reasoning?.graph ?? []).filter(
    (n): n is Extract<GraphNode, { type: 'hitl' }> => n.type === 'hitl',
  );
  for (const node of graphHitlNodes) {
    if (!known.has(node.gate_id)) {
      errors.push({
        code: 'CONFIG_HITL_GATE_UNKNOWN',
        layer: 'reasoning.graph',
        field: node.id,
        message: `Unknown HITL gate '${node.gate_id}'.`,
      });
    }
  }
  return errors;
};

/**
 * V-7 (Phase 14, BL-057) — every **blocking** `HitlGate` reachable from this
 * config (a `hitl`-type graph node, a gated consequential tool, or a gated
 * skill) needs reviewer coverage before publish. Deferred/pre_speech gates
 * are exempt — R-H3's "cannot be published to production" language is
 * specific to blocking gates (the ones a live turn actually waits on).
 */
const blockingGateReviewerCoverageRule: Rule = (ctx) => {
  const gates = ctx.hitlGatesById ?? new Map();
  if (gates.size === 0) {
    return [];
  }
  const referencedGateIds = new Set<string>();
  for (const node of ctx.config.reasoning?.graph ?? []) {
    if (node.type === 'hitl') {
      referencedGateIds.add(node.gate_id);
    }
  }
  for (const gateId of ctx.toolGateIdByApiRef?.values() ?? []) {
    referencedGateIds.add(gateId);
  }
  for (const skill of ctx.publishedSkills?.values() ?? []) {
    if (skill.hitlGateId) {
      referencedGateIds.add(skill.hitlGateId);
    }
  }
  const errors: ConfigError[] = [];
  for (const gateId of referencedGateIds) {
    const gate = gates.get(gateId);
    if (!gate || gate.gateType !== 'blocking' || gate.hasReviewerCoverage) {
      continue;
    }
    errors.push({
      code: 'HITL_REVIEWER_COVERAGE_MISSING',
      layer: 'reasoning.graph',
      field: gateId,
      message: `Blocking gate '${gateId}' needs a reviewer group with at least one member and a notification channel before publish.`,
    });
  }
  return errors;
};

/**
 * V-3 (Phase 15, BL-058, R-G6) — every `subagent`-type node's
 * `target_tenant_id` must reference a tenant with a **published** config
 * (existence half), must not reference this config's own tenant
 * (degenerate self-delegation), and must not itself delegate one hop
 * further (the nesting-depth half — this config's own node is hop 1, the
 * target's own `subagent` node, if any, would be hop 2, and *that* node's
 * own target existing at all would put the total chain at 3 hops,
 * exceeding R-G6's ≤2). Mirrors `skillRefsKnownAndEnabledRule`'s existence-
 * check shape; the self-reference and nesting checks are this rule's own
 * addition since no prior by-reference rule here needed either.
 */
const subAgentTargetsValidRule: Rule = (ctx) => {
  const targets = ctx.subAgentTargetsById ?? new Map();
  const errors: ConfigError[] = [];
  const subAgentNodes = (ctx.config.reasoning?.graph ?? []).filter(
    (n): n is Extract<GraphNode, { type: 'subagent' }> => n.type === 'subagent',
  );
  for (const node of subAgentNodes) {
    if (ctx.tenantId && node.target_tenant_id === ctx.tenantId) {
      errors.push({
        code: 'CONFIG_SUBAGENT_SELF_REFERENCE',
        layer: 'reasoning.graph',
        field: node.id,
        message: 'A Sub-agent node cannot delegate to its own tenant.',
      });
      continue;
    }
    const target = targets.get(node.target_tenant_id);
    if (!target || !target.published) {
      errors.push({
        code: 'CONFIG_SUBAGENT_TENANT_UNKNOWN',
        layer: 'reasoning.graph',
        field: node.id,
        message: `Unknown or unpublished target agent '${node.target_tenant_id}'.`,
      });
      continue;
    }
    if (target.hasSubAgentNode) {
      errors.push({
        code: 'CONFIG_SUBAGENT_NESTING_EXCEEDED',
        layer: 'reasoning.graph',
        field: node.id,
        message: `Sub-agent node '${node.id}' would exceed the 2-level nesting limit (R-G6) — the target agent already delegates to another sub-agent.`,
      });
    }
  }
  return errors;
};

/** Gate B — combination rules, run in this order (LLD §8.2). */
export const COMBINATION_RULES: Rule[] = [
  completenessRule,
  transportSupportedRule,
  providerEnabledRule,
  credentialExistsRule,
  fallbackDiffersRule,
  residencyBlocksRemoteLlmRule,
  toolRefsKnownRule,
  criticalPathWithinBudgetRule,
  knowledgeSourceNotStaleRule,
  skillRefsKnownAndEnabledRule,
  basePromptCostWithinCeilingRule,
  consequentialToolGatedOrAckedRule,
  hitlGateRefsKnownRule,
  blockingGateReviewerCoverageRule,
  subAgentTargetsValidRule,
];

/**
 * Runs every Gate-B rule and concatenates their errors.
 * @param ctx - Validation context (catalog + credentials loaded once)
 */
export function runCombinationRules(ctx: ValidationContext): ConfigError[] {
  return COMBINATION_RULES.flatMap((rule) => rule(ctx));
}
