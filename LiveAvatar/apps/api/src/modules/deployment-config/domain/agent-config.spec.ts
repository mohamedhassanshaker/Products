import {
  AgentConfigParseError,
  buildSingleLlmNodeGraph,
  emptyAgentConfig,
  findLlmNodes,
  parseAgentConfigYaml,
  stringifyAgentConfig,
} from './agent-config';

describe('parseAgentConfigYaml', () => {
  it('parses a valid document', () => {
    expect(parseAgentConfigYaml('version: 1\nname: acme\n')).toEqual({ version: 1, name: 'acme' });
  });

  it('treats an empty document as an empty object', () => {
    expect(parseAgentConfigYaml('')).toEqual({});
  });

  it('throws AgentConfigParseError with the parser reason on malformed YAML', () => {
    expect(() => parseAgentConfigYaml('{ not: [valid')).toThrow(AgentConfigParseError);
  });
});

describe('stringifyAgentConfig', () => {
  it('round-trips a structured config', () => {
    const yaml = stringifyAgentConfig({ version: 1, transport: { provider: 'livekit' } });
    expect(parseAgentConfigYaml(yaml)).toEqual({ version: 1, transport: { provider: 'livekit' } });
  });
});

describe('emptyAgentConfig', () => {
  it('builds the new-tenant placeholder skeleton with every selectable field unset', () => {
    const config = emptyAgentConfig('tenant-1', 'acme', 'Acme');
    expect(config.deployment).toEqual({ tenant_id: 'tenant-1', name: 'Acme' });
    expect(config.transport).toEqual({ provider: 'livekit', room_namespace: 'acme' });
    expect(config.stt?.provider).toBeUndefined();
    // Phase 9 (BL-035): a brand-new tenant has no `reasoning` block at all —
    // no valid single-LLM-node graph to default to until a provider is chosen.
    expect(config.reasoning).toBeUndefined();
    expect(config.tts?.provider).toBeUndefined();
    expect(config.avatar?.provider).toBeUndefined();
  });
});

describe('findLlmNodes', () => {
  it('returns an empty array when reasoning is absent', () => {
    expect(findLlmNodes(undefined)).toEqual([]);
  });

  it('returns an empty array when the graph has no llm-type node', () => {
    const endNode = {
      id: 'end-1',
      type: 'end' as const,
      name: 'End',
      lane: 'foreground' as const,
      on_error: { action: 'degrade' as const },
      on_deadline: { action: 'degrade' as const },
    };
    expect(
      findLlmNodes({ graph: [endNode], entry_node_id: 'end-1', background_entry_node_ids: [], turn_budget_ms: 3000 }),
    ).toEqual([]);
  });

  it('returns every llm-type node in graph order, ignoring other node types', () => {
    const reasoning = buildSingleLlmNodeGraph({ provider: 'openai', model: 'gpt-4o' });
    const secondLlmNode = { ...reasoning.graph[0], id: 'llm-2', provider: 'anthropic', model: 'claude-3-5-sonnet' };
    const routerNode = {
      id: 'router-1',
      type: 'router' as const,
      name: 'Route',
      lane: 'foreground' as const,
      on_error: { action: 'degrade' as const },
      on_deadline: { action: 'degrade' as const },
      branches: [{ condition: 'utterance == "x"', next_node_id: 'llm-1' }],
      default_next_node_id: 'llm-2',
    };
    const found = findLlmNodes({
      ...reasoning,
      graph: [reasoning.graph[0], routerNode, secondLlmNode] as typeof reasoning.graph,
    });
    expect(found.map((n) => n.id)).toEqual(['llm-1', 'llm-2']);
  });
});

describe('buildSingleLlmNodeGraph', () => {
  it('builds a minimal, structurally valid single-LLM-node graph (R-G1 default shape)', () => {
    const reasoning = buildSingleLlmNodeGraph({ provider: 'openai', credential_ref: 'secrets/openai', model: 'gpt-4o' });
    expect(reasoning.entry_node_id).toBe('llm-1');
    expect(reasoning.background_entry_node_ids).toEqual([]);
    expect(reasoning.turn_budget_ms).toBe(3000);
    expect(reasoning.graph).toHaveLength(1);
    const [node] = reasoning.graph;
    expect(node).toMatchObject({
      id: 'llm-1',
      type: 'llm',
      lane: 'foreground',
      provider: 'openai',
      credential_ref: 'secrets/openai',
      model: 'gpt-4o',
      next_node_id: null,
    });
  });

  it('carries an optional fallback leg through unchanged', () => {
    const reasoning = buildSingleLlmNodeGraph({
      provider: 'openai',
      model: 'gpt-4o',
      fallback: { provider: 'anthropic', model: 'claude-3-5-sonnet', credential_ref: 'secrets/anthropic' },
    });
    expect(reasoning.graph[0]).toMatchObject({
      fallback: { provider: 'anthropic', model: 'claude-3-5-sonnet', credential_ref: 'secrets/anthropic' },
    });
  });

  it('every node built resolves back via findLlmNodes', () => {
    const reasoning = buildSingleLlmNodeGraph({ provider: 'openai', model: 'gpt-4o' });
    expect(findLlmNodes(reasoning)).toHaveLength(1);
  });
});
