import { knowledgeSourceNotStaleRule, runCombinationRules, type ValidationContext } from './combination-rules';

function baseCtx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    config: {},
    catalog: new Map(),
    credentialsByProviderKey: new Map(),
    knownToolRefs: new Set(),
    ...overrides,
  };
}

describe('combination-rules', () => {
  it('flags CONFIG_TRANSPORT_UNSUPPORTED for a non-livekit transport (defensive — schema already blocks this in practice)', () => {
    const errors = runCombinationRules(baseCtx({ config: { transport: { provider: 'twilio' } } }));
    expect(errors.some((e) => e.code === 'CONFIG_TRANSPORT_UNSUPPORTED')).toBe(true);
  });

  it('does not flag transport when it is livekit', () => {
    const errors = runCombinationRules(baseCtx({ config: { transport: { provider: 'livekit' } } }));
    expect(errors.some((e) => e.code === 'CONFIG_TRANSPORT_UNSUPPORTED')).toBe(false);
  });

  it('flags an unknown tool api_ref', () => {
    const errors = runCombinationRules(
      baseCtx({ config: { agent: { tools: [{ name: 'Weather', api_ref: 'weather-api', enabled: true }] } } }),
    );
    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_TOOL_UNKNOWN', field: 'weather-api' })]),
    );
  });

  it('accepts a known tool api_ref', () => {
    const errors = runCombinationRules(
      baseCtx({
        config: { agent: { tools: [{ name: 'Weather', api_ref: 'weather-api', enabled: true }] } },
        knownToolRefs: new Set(['weather-api']),
      }),
    );
    expect(errors.some((e) => e.code === 'CONFIG_TOOL_UNKNOWN')).toBe(false);
  });

  describe('toolRefsKnownRule — reasoning.graph Tool nodes (Phase 9, BL-035)', () => {
    const toolNode = (apiRef: string) => ({
      id: 'tool-1',
      type: 'tool' as const,
      name: 'Lookup',
      lane: 'foreground' as const,
      on_error: { action: 'degrade' as const },
      on_deadline: { action: 'degrade' as const },
      api_ref: apiRef,
      argument_mapping: {},
      next_node_id: null,
    });

    it('flags an unknown tool api_ref on a graph Tool node', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: {
            reasoning: {
              graph: [toolNode('weather-api')],
              entry_node_id: 'tool-1',
              background_entry_node_ids: [],
              turn_budget_ms: 3000,
            },
          },
        }),
      );
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'CONFIG_TOOL_UNKNOWN', layer: 'reasoning.graph', field: 'tool-1' }),
        ]),
      );
    });

    it('accepts a graph Tool node whose api_ref is known', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: {
            reasoning: {
              graph: [toolNode('weather-api')],
              entry_node_id: 'tool-1',
              background_entry_node_ids: [],
              turn_budget_ms: 3000,
            },
          },
          knownToolRefs: new Set(['weather-api']),
        }),
      );
      expect(errors.some((e) => e.code === 'CONFIG_TOOL_UNKNOWN')).toBe(false);
    });

    it('ignores non-Tool graph nodes (an llm node has no api_ref to check)', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: {
            reasoning: {
              graph: [
                {
                  id: 'llm-1',
                  type: 'llm' as const,
                  name: 'Answer',
                  lane: 'foreground' as const,
                  on_error: { action: 'degrade' as const },
                  on_deadline: { action: 'degrade' as const },
                  provider: 'openai',
                  model: 'gpt-4o',
                  retry: { max_attempts: 3, backoff_ms: [200, 400, 800] },
                  next_node_id: null,
                },
              ],
              entry_node_id: 'llm-1',
              background_entry_node_ids: [],
              turn_budget_ms: 3000,
            },
          },
        }),
      );
      expect(errors.some((e) => e.code === 'CONFIG_TOOL_UNKNOWN')).toBe(false);
    });
  });

  describe('knowledgeSourceNotStaleRule (Phase 12b, V-9 — registered, per-Retrieve-node-reference)', () => {
    function retrieveNode(id: string, sourceRefs: string[]): ValidationContext['config']['reasoning'] {
      return {
        entry_node_id: id,
        background_entry_node_ids: [],
        turn_budget_ms: 3000,
        graph: [
          {
            id,
            type: 'retrieve',
            name: 'Look up',
            lane: 'foreground',
            on_error: { action: 'degrade' },
            on_deadline: { action: 'degrade' },
            source_refs: sourceRefs,
            top_k: 5,
            budget_ms: 400,
            next_node_id: null,
          },
        ],
      } as unknown as ValidationContext['config']['reasoning'];
    }

    it('produces no warnings when ctx.knowledgeSources is absent', () => {
      expect(knowledgeSourceNotStaleRule(baseCtx())).toEqual([]);
    });

    it('produces no warnings when every source is fresh', () => {
      const errors = knowledgeSourceNotStaleRule(
        baseCtx({
          config: { reasoning: retrieveNode('retrieve-1', ['s1']) },
          knowledgeSources: [{ id: 's1', name: 'Docs', isStale: false }],
        }),
      );
      expect(errors).toEqual([]);
    });

    it('produces no warnings for a stale source no live Retrieve node references', () => {
      const errors = knowledgeSourceNotStaleRule(
        baseCtx({
          config: { reasoning: retrieveNode('retrieve-1', ['s2']) },
          knowledgeSources: [{ id: 's1', name: 'Docs', isStale: true }],
        }),
      );
      expect(errors).toEqual([]);
    });

    it('flags a stale, referenced source as a non-blocking warning attached to the referencing node id', () => {
      const errors = knowledgeSourceNotStaleRule(
        baseCtx({
          config: { reasoning: retrieveNode('retrieve-1', ['s1', 's2']) },
          knowledgeSources: [
            { id: 's1', name: 'Docs', isStale: true },
            { id: 's2', name: 'FAQ', isStale: false },
          ],
        }),
      );
      expect(errors).toEqual([
        expect.objectContaining({
          code: 'KNOWLEDGE_SOURCE_STALE',
          layer: 'reasoning.graph',
          field: 'retrieve-1',
          severity: 'warning',
        }),
      ]);
    });

    it('is registered in COMBINATION_RULES and never blocks (severity: warning)', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: { reasoning: retrieveNode('retrieve-1', ['s1']) },
          knowledgeSources: [{ id: 's1', name: 'Docs', isStale: true }],
        }),
      );
      const staleErrors = errors.filter((e) => e.code === 'KNOWLEDGE_SOURCE_STALE');
      expect(staleErrors).toHaveLength(1);
      expect(staleErrors[0].severity).toBe('warning');
    });
  });

  describe('V-12 skillRefsKnownAndEnabledRule (Phase 13, BL-049/050/051)', () => {
    const skillNode = (skillId: string) => ({
      id: 'skill-node-1',
      type: 'skill' as const,
      name: 'Refunds skill',
      lane: 'foreground' as const,
      on_error: { action: 'degrade' as const },
      on_deadline: { action: 'degrade' as const },
      skill_id: skillId,
      version: 1,
      budget_ms: 1500,
      next_node_id: null,
    });

    it('flags an unknown skill referenced in the top-level skills[] attach list', () => {
      const errors = runCombinationRules(baseCtx({ config: { skills: [{ id: 'skill-1', version: 1 }] } }));
      expect(errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_SKILL_UNKNOWN', layer: 'skills', field: 'skill-1' })]),
      );
    });

    it('accepts a known, published skill in the attach list', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: { skills: [{ id: 'skill-1', version: 1 }] },
          publishedSkills: new Map([['skill-1', { name: 'Refunds', description: 'Handle refunds' }]]),
        }),
      );
      expect(errors.some((e) => e.code === 'CONFIG_SKILL_UNKNOWN')).toBe(false);
    });

    it('flags an unknown skill referenced by a skill-type graph node, attached to the node id', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: {
            reasoning: {
              graph: [skillNode('skill-1')],
              entry_node_id: 'skill-node-1',
              background_entry_node_ids: [],
              turn_budget_ms: 3000,
            },
          },
        }),
      );
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'CONFIG_SKILL_UNKNOWN', layer: 'reasoning.graph', field: 'skill-node-1' }),
        ]),
      );
    });

    it('accepts a graph skill node whose skill_id is known and published', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: {
            reasoning: {
              graph: [skillNode('skill-1')],
              entry_node_id: 'skill-node-1',
              background_entry_node_ids: [],
              turn_budget_ms: 3000,
            },
          },
          publishedSkills: new Map([['skill-1', { name: 'Refunds', description: 'Handle refunds' }]]),
        }),
      );
      expect(errors.some((e) => e.code === 'CONFIG_SKILL_UNKNOWN')).toBe(false);
    });
  });

  describe('V-11 basePromptCostWithinCeilingRule (Phase 13, BL-049/050/051) — warning-class', () => {
    it('produces no warning for a small base prompt with no attachments', () => {
      const errors = runCombinationRules(baseCtx({ config: { agent: { system_prompt: 'hi', tools: [] } } }));
      expect(errors.some((e) => e.code === 'CONFIG_BASE_PROMPT_COST_HIGH')).toBe(false);
    });

    it('flags an oversized base prompt as a non-blocking warning', () => {
      const errors = runCombinationRules(
        baseCtx({ config: { agent: { system_prompt: 'x'.repeat(20000), tools: [] } } }),
      );
      const warning = errors.find((e) => e.code === 'CONFIG_BASE_PROMPT_COST_HIGH');
      expect(warning).toBeDefined();
      expect(warning?.severity).toBe('warning');
    });

    it('includes attached skill description costs in the sum', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: {
            agent: { system_prompt: 'x'.repeat(15000), tools: [] },
            skills: [{ id: 'skill-1', version: 1 }],
          },
          publishedSkills: new Map([['skill-1', { name: 'Refunds', description: 'x'.repeat(2000) }]]),
        }),
      );
      expect(errors.some((e) => e.code === 'CONFIG_BASE_PROMPT_COST_HIGH')).toBe(true);
    });

    it('includes an always-on tool\'s args_schema cost in the sum (Phase 16, BL-063 — "tool schemas," not just descriptions)', () => {
      // A prompt sized just under the default 4000-token ceiling on its own
      // (~3975 tokens) plus a negligible description: only a real
      // args_schema contribution can push this over.
      const baseConfig = {
        agent: { system_prompt: 'x'.repeat(15900), tools: [{ name: 'Weather', api_ref: 'weather-api', enabled: true }] },
      };
      const withoutSchema = runCombinationRules(
        baseCtx({ config: baseConfig, knownToolRefs: new Set(['weather-api']), toolDescriptionsByApiRef: new Map([['weather-api', { description: 'w', argsSchema: {} }]]) }),
      );
      const withSchema = runCombinationRules(
        baseCtx({
          config: baseConfig,
          knownToolRefs: new Set(['weather-api']),
          toolDescriptionsByApiRef: new Map([['weather-api', { description: 'w', argsSchema: { filler: 'x'.repeat(1000) } }]]),
        }),
      );
      expect(withoutSchema.some((e) => e.code === 'CONFIG_BASE_PROMPT_COST_HIGH')).toBe(false);
      expect(withSchema.some((e) => e.code === 'CONFIG_BASE_PROMPT_COST_HIGH')).toBe(true);
    });

    it('never blocks publish (severity: warning filters it out of the blocking set)', () => {
      const errors = runCombinationRules(
        baseCtx({ config: { agent: { system_prompt: 'x'.repeat(20000), tools: [] } } }),
      );
      const blocking = errors.filter((e) => e.severity !== 'warning');
      expect(blocking.some((e) => e.code === 'CONFIG_BASE_PROMPT_COST_HIGH')).toBe(false);
    });
  });

  describe('Phase 14 (BL-057) — V-6 consequentialToolGatedOrAckedRule', () => {
    it('flags a consequential tool with no gate and no acknowledgement', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: { agent: { tools: [{ name: 'Refund', api_ref: 'refund-api', enabled: true }] } },
          knownToolRefs: new Set(['refund-api']),
          consequentialToolApiRefs: new Set(['refund-api']),
        }),
      );
      expect(errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_CONSEQUENTIAL_TOOL_UNGATED', field: 'refund-api' })]),
      );
    });

    it('accepts a consequential tool with a written acknowledgement and no gate', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: { agent: { tools: [{ name: 'Refund', api_ref: 'refund-api', enabled: true }] } },
          knownToolRefs: new Set(['refund-api']),
          consequentialToolApiRefs: new Set(['refund-api']),
          toolAutonomousAckByApiRef: new Map([['refund-api', 'Reviewed and accepted.']]),
        }),
      );
      expect(errors.some((e) => e.code === 'CONFIG_CONSEQUENTIAL_TOOL_UNGATED')).toBe(false);
    });

    it('accepts a consequential tool with a gate attached and no acknowledgement', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: { agent: { tools: [{ name: 'Refund', api_ref: 'refund-api', enabled: true }] } },
          knownToolRefs: new Set(['refund-api']),
          consequentialToolApiRefs: new Set(['refund-api']),
          toolGateIdByApiRef: new Map([['refund-api', 'gate-1']]),
        }),
      );
      expect(errors.some((e) => e.code === 'CONFIG_CONSEQUENTIAL_TOOL_UNGATED')).toBe(false);
    });

    it('does not flag a non-consequential tool with no gate/ack', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: { agent: { tools: [{ name: 'Weather', api_ref: 'weather-api', enabled: true }] } },
          knownToolRefs: new Set(['weather-api']),
          consequentialToolApiRefs: new Set(['refund-api']),
        }),
      );
      expect(errors.some((e) => e.code === 'CONFIG_CONSEQUENTIAL_TOOL_UNGATED')).toBe(false);
    });
  });

  describe('Phase 14 (BL-052..057) — hitlGateRefsKnownRule and V-7 blockingGateReviewerCoverageRule', () => {
    const hitlNode = (gateId: string) => ({
      id: 'hitl-node-1',
      type: 'hitl' as const,
      name: 'Approve refund',
      lane: 'foreground' as const,
      on_error: { action: 'degrade' as const },
      on_deadline: { action: 'degrade' as const },
      gate_id: gateId,
      next_node_id: null,
    });

    it('flags a hitl-type node referencing an unknown gate', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: {
            reasoning: { graph: [hitlNode('gate-1')], entry_node_id: 'hitl-node-1', background_entry_node_ids: [], turn_budget_ms: 3000 },
          },
        }),
      );
      expect(errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_HITL_GATE_UNKNOWN', field: 'hitl-node-1' })]),
      );
    });

    it('flags a blocking gate with no reviewer coverage', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: {
            reasoning: { graph: [hitlNode('gate-1')], entry_node_id: 'hitl-node-1', background_entry_node_ids: [], turn_budget_ms: 3000 },
          },
          hitlGatesById: new Map([['gate-1', { gateType: 'blocking', hasReviewerCoverage: false }]]),
        }),
      );
      expect(errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'HITL_REVIEWER_COVERAGE_MISSING', field: 'gate-1' })]),
      );
    });

    it('accepts a blocking gate with reviewer coverage', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: {
            reasoning: { graph: [hitlNode('gate-1')], entry_node_id: 'hitl-node-1', background_entry_node_ids: [], turn_budget_ms: 3000 },
          },
          hitlGatesById: new Map([['gate-1', { gateType: 'blocking', hasReviewerCoverage: true }]]),
        }),
      );
      expect(errors.some((e) => e.code === 'HITL_REVIEWER_COVERAGE_MISSING')).toBe(false);
      expect(errors.some((e) => e.code === 'CONFIG_HITL_GATE_UNKNOWN')).toBe(false);
    });

    it('does not require reviewer coverage for a non-blocking (deferred) gate', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: {
            reasoning: { graph: [hitlNode('gate-1')], entry_node_id: 'hitl-node-1', background_entry_node_ids: [], turn_budget_ms: 3000 },
          },
          hitlGatesById: new Map([['gate-1', { gateType: 'deferred', hasReviewerCoverage: false }]]),
        }),
      );
      expect(errors.some((e) => e.code === 'HITL_REVIEWER_COVERAGE_MISSING')).toBe(false);
    });
  });

  describe('Phase 15 (BL-058, V-3/R-G6) — subAgentTargetsValidRule', () => {
    const subAgentNode = (targetTenantId: string) => ({
      id: 'subagent-node-1',
      type: 'subagent' as const,
      name: 'Delegate to billing',
      lane: 'foreground' as const,
      on_error: { action: 'degrade' as const },
      on_deadline: { action: 'degrade' as const },
      target_tenant_id: targetTenantId,
      handback_policy: 'speak_and_return' as const,
      budget_ms: 4000,
      next_node_id: null,
    });
    const reasoningWith = (node: ReturnType<typeof subAgentNode>) => ({
      graph: [node],
      entry_node_id: 'subagent-node-1',
      background_entry_node_ids: [],
      turn_budget_ms: 3000,
    });

    it('flags a target tenant with no published config', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: { reasoning: reasoningWith(subAgentNode('tenant-b')) },
          subAgentTargetsById: new Map([['tenant-b', { published: false, hasSubAgentNode: false }]]),
        }),
      );
      expect(errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_SUBAGENT_TENANT_UNKNOWN', field: 'subagent-node-1' })]),
      );
    });

    it('flags a config delegating to its own tenant', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: { reasoning: reasoningWith(subAgentNode('tenant-a')) },
          tenantId: 'tenant-a',
          subAgentTargetsById: new Map([['tenant-a', { published: true, hasSubAgentNode: false }]]),
        }),
      );
      expect(errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_SUBAGENT_SELF_REFERENCE', field: 'subagent-node-1' })]),
      );
    });

    it('flags nesting beyond 2 levels — the target itself delegates further', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: { reasoning: reasoningWith(subAgentNode('tenant-b')) },
          tenantId: 'tenant-a',
          subAgentTargetsById: new Map([['tenant-b', { published: true, hasSubAgentNode: true }]]),
        }),
      );
      expect(errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_SUBAGENT_NESTING_EXCEEDED', field: 'subagent-node-1' })]),
      );
    });

    it('accepts a published, non-self, non-further-delegating target', () => {
      const errors = runCombinationRules(
        baseCtx({
          config: { reasoning: reasoningWith(subAgentNode('tenant-b')) },
          tenantId: 'tenant-a',
          subAgentTargetsById: new Map([['tenant-b', { published: true, hasSubAgentNode: false }]]),
        }),
      );
      expect(
        errors.some((e) =>
          ['CONFIG_SUBAGENT_TENANT_UNKNOWN', 'CONFIG_SUBAGENT_SELF_REFERENCE', 'CONFIG_SUBAGENT_NESTING_EXCEEDED'].includes(e.code),
        ),
      ).toBe(false);
    });
  });
});
