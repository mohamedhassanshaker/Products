import { validateGraphStructure } from './graph-structure';
import { buildSingleLlmNodeGraph } from './agent-config';
import type { GraphNode, Reasoning } from '@liveavatar/contracts';

const edge = { action: 'degrade' as const };

function llmNode(overrides: Partial<Extract<GraphNode, { type: 'llm' }>> = {}): Extract<GraphNode, { type: 'llm' }> {
  return {
    id: 'llm-1',
    type: 'llm',
    name: 'Answer',
    lane: 'foreground',
    on_error: edge,
    on_deadline: edge,
    provider: 'openai',
    model: 'gpt-4o',
    retry: { max_attempts: 3, backoff_ms: [200, 400, 800] },
    next_node_id: null,
    ...overrides,
  };
}

function toolNode(overrides: Partial<Extract<GraphNode, { type: 'tool' }>> = {}): Extract<GraphNode, { type: 'tool' }> {
  return {
    id: 'tool-1',
    type: 'tool',
    name: 'Lookup',
    lane: 'foreground',
    on_error: edge,
    on_deadline: edge,
    api_ref: 'weather-api',
    argument_mapping: {},
    next_node_id: null,
    ...overrides,
  };
}

function routerNode(overrides: Partial<Extract<GraphNode, { type: 'router' }>> = {}): Extract<GraphNode, { type: 'router' }> {
  return {
    id: 'router-1',
    type: 'router',
    name: 'Route',
    lane: 'foreground',
    on_error: edge,
    on_deadline: edge,
    branches: [{ condition: 'utterance == "x"', next_node_id: 'llm-1' }],
    default_next_node_id: 'llm-1',
    ...overrides,
  };
}

function speakNode(overrides: Partial<Extract<GraphNode, { type: 'speak' }>> = {}): Extract<GraphNode, { type: 'speak' }> {
  return {
    id: 'speak-1',
    type: 'speak',
    name: 'Speak',
    lane: 'foreground',
    on_error: edge,
    on_deadline: edge,
    mode: 'llm_output',
    interruptible: true,
    next_node_id: null,
    ...overrides,
  };
}

function endNode(overrides: Partial<Extract<GraphNode, { type: 'end' }>> = {}): Extract<GraphNode, { type: 'end' }> {
  return { id: 'end-1', type: 'end', name: 'End', lane: 'foreground', on_error: edge, on_deadline: edge, ...overrides };
}

function parallelNode(overrides: Partial<Extract<GraphNode, { type: 'parallel' }>> = {}): Extract<GraphNode, { type: 'parallel' }> {
  return {
    id: 'parallel-1',
    type: 'parallel',
    name: 'Fan out',
    lane: 'foreground',
    on_error: edge,
    on_deadline: edge,
    branches: [{ id: 'branch-a', entry_node_id: 'llm-1' }],
    join_policy: 'all',
    on_branch_error: 'continue_partial',
    next_node_id: null,
    ...overrides,
  };
}

function loopNode(overrides: Partial<Extract<GraphNode, { type: 'loop' }>> = {}): Extract<GraphNode, { type: 'loop' }> {
  return {
    id: 'loop-1',
    type: 'loop',
    name: 'Refine',
    lane: 'foreground',
    on_error: edge,
    on_deadline: edge,
    body_entry_node_id: 'llm-1',
    condition: 'utterance == "done"',
    max_iterations: 3,
    max_duration_ms: 5000,
    max_cost: 10,
    next_node_id: null,
    ...overrides,
  };
}

function subAgentNode(overrides: Partial<Extract<GraphNode, { type: 'subagent' }>> = {}): Extract<GraphNode, { type: 'subagent' }> {
  return {
    id: 'subagent-1',
    type: 'subagent',
    name: 'Delegate',
    lane: 'foreground',
    on_error: edge,
    on_deadline: edge,
    target_tenant_id: 'tenant-b',
    handback_policy: 'speak_and_return',
    budget_ms: 4000,
    next_node_id: null,
    ...overrides,
  };
}

function handoffNode(overrides: Partial<Extract<GraphNode, { type: 'handoff' }>> = {}): Extract<GraphNode, { type: 'handoff' }> {
  return {
    id: 'handoff-1',
    type: 'handoff',
    name: 'Transfer',
    lane: 'foreground',
    on_error: edge,
    on_deadline: edge,
    destination: 'billing-queue',
    context_summary: 'Caller disputes a charge.',
    ...overrides,
  };
}

function stateNode(overrides: Partial<Extract<GraphNode, { type: 'state' }>> = {}): Extract<GraphNode, { type: 'state' }> {
  return {
    id: 'state-1',
    type: 'state',
    name: 'Store name',
    lane: 'foreground',
    on_error: edge,
    on_deadline: edge,
    mode: 'write',
    variable: 'caller_name',
    value: 'Jordan',
    next_node_id: null,
    ...overrides,
  };
}

function reasoning(graph: GraphNode[], overrides: Partial<Reasoning> = {}): Reasoning {
  return { graph, entry_node_id: graph[0]?.id ?? 'missing', background_entry_node_ids: [], turn_budget_ms: 3000, ...overrides };
}

describe('validateGraphStructure', () => {
  it('returns no errors when reasoning is absent (a brand-new tenant — Gate B reports that separately)', () => {
    expect(validateGraphStructure(undefined)).toEqual([]);
  });

  it('a fully-valid single-LLM-node graph produces zero errors', () => {
    expect(validateGraphStructure(buildSingleLlmNodeGraph({ provider: 'openai', model: 'gpt-4o' }))).toEqual([]);
  });

  it('a fully-valid multi-node graph (Router -> Tool/LLM -> Speak -> End) produces zero errors', () => {
    const graph: GraphNode[] = [
      routerNode({ id: 'router-1', branches: [{ condition: 'utterance == "weather"', next_node_id: 'tool-1' }], default_next_node_id: 'llm-1' }),
      toolNode({ id: 'tool-1', next_node_id: 'speak-1' }),
      llmNode({ id: 'llm-1', next_node_id: 'speak-1' }),
      speakNode({ id: 'speak-1', next_node_id: 'end-1' }),
      endNode({ id: 'end-1' }),
    ];
    const errors = validateGraphStructure(reasoning(graph, { entry_node_id: 'router-1' }));
    expect(errors).toEqual([]);
  });

  it('flags a duplicate node id', () => {
    const graph: GraphNode[] = [llmNode({ id: 'llm-1' }), endNode({ id: 'llm-1' })];
    const errors = validateGraphStructure(reasoning(graph));
    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_GRAPH_NODE_ID_DUPLICATE', field: 'llm-1' })]),
    );
  });

  it('flags a dangling next_node_id', () => {
    const graph: GraphNode[] = [llmNode({ next_node_id: 'does-not-exist' })];
    const errors = validateGraphStructure(reasoning(graph));
    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_GRAPH_REF_UNKNOWN', field: 'llm-1/next_node_id' })]),
    );
  });

  it('flags a dangling entry_node_id', () => {
    const graph: GraphNode[] = [llmNode()];
    const errors = validateGraphStructure(reasoning(graph, { entry_node_id: 'not-a-real-node' }));
    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_GRAPH_ENTRY_UNKNOWN', field: 'not-a-real-node' })]),
    );
  });

  it('flags a dangling router branch target', () => {
    const graph: GraphNode[] = [
      routerNode({ branches: [{ condition: 'utterance == "x"', next_node_id: 'ghost' }], default_next_node_id: 'router-1' }),
    ];
    const errors = validateGraphStructure(reasoning(graph, { entry_node_id: 'router-1' }));
    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_GRAPH_REF_UNKNOWN', field: 'router-1/branches' })]),
    );
  });

  it('flags a dangling router default_next_node_id target', () => {
    const graph: GraphNode[] = [
      routerNode({ branches: [{ condition: 'utterance == "x"', next_node_id: 'router-1' }], default_next_node_id: 'ghost-default' }),
    ];
    const errors = validateGraphStructure(reasoning(graph, { entry_node_id: 'router-1' }));
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'CONFIG_GRAPH_REF_UNKNOWN', field: 'router-1/default_next_node_id' }),
      ]),
    );
  });

  it('flags a dangling background_entry_node_ids entry', () => {
    const graph: GraphNode[] = [llmNode()];
    const errors = validateGraphStructure(reasoning(graph, { background_entry_node_ids: ['ghost-bg'] }));
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'CONFIG_GRAPH_REF_UNKNOWN', field: 'background_entry_node_ids/ghost-bg' }),
      ]),
    );
  });

  it('flags a dangling on_error goto target', () => {
    const graph: GraphNode[] = [llmNode({ on_error: { action: 'goto', target_node_id: 'ghost-error' } })];
    const errors = validateGraphStructure(reasoning(graph));
    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_GRAPH_REF_UNKNOWN', field: 'llm-1/on_error' })]),
    );
  });

  it('flags a dangling on_deadline goto target', () => {
    const graph: GraphNode[] = [llmNode({ on_deadline: { action: 'goto', target_node_id: 'ghost-deadline' } })];
    const errors = validateGraphStructure(reasoning(graph));
    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_GRAPH_REF_UNKNOWN', field: 'llm-1/on_deadline' })]),
    );
  });

  it('does not flag an on_error/on_deadline edge whose action is not goto, even without a target_node_id', () => {
    const graph: GraphNode[] = [llmNode({ on_error: { action: 'end_turn' }, on_deadline: { action: 'degrade' } })];
    const errors = validateGraphStructure(reasoning(graph));
    expect(errors).toEqual([]);
  });

  it('an End node has no next_node_id/branches to check and produces no reference errors', () => {
    const graph: GraphNode[] = [endNode()];
    const errors = validateGraphStructure(reasoning(graph, { entry_node_id: 'end-1' }));
    expect(errors).toEqual([]);
  });

  it('accumulates multiple distinct errors from one malformed graph', () => {
    const graph: GraphNode[] = [llmNode({ id: 'dup', next_node_id: 'ghost' }), endNode({ id: 'dup' })];
    const errors = validateGraphStructure(reasoning(graph, { entry_node_id: 'nowhere' }));
    const codes = errors.map((e) => e.code);
    expect(codes).toEqual(
      expect.arrayContaining(['CONFIG_GRAPH_NODE_ID_DUPLICATE', 'CONFIG_GRAPH_ENTRY_UNKNOWN', 'CONFIG_GRAPH_REF_UNKNOWN']),
    );
  });

  describe('Parallel/Loop referential integrity (Phase 11, BL-042/043)', () => {
    it('a fully-valid Parallel node produces zero errors', () => {
      const graph: GraphNode[] = [
        parallelNode({ branches: [{ id: 'a', entry_node_id: 'llm-1' }], next_node_id: 'end-1' }),
        llmNode({ next_node_id: null }),
        endNode(),
      ];
      expect(validateGraphStructure(reasoning(graph, { entry_node_id: 'parallel-1' }))).toEqual([]);
    });

    it('flags a dangling Parallel branch entry_node_id', () => {
      const graph: GraphNode[] = [parallelNode({ branches: [{ id: 'a', entry_node_id: 'ghost' }] })];
      const errors = validateGraphStructure(reasoning(graph, { entry_node_id: 'parallel-1' }));
      expect(errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_GRAPH_REF_UNKNOWN', field: 'parallel-1/branches/a' })]),
      );
    });

    it('flags a dangling Parallel next_node_id', () => {
      const graph: GraphNode[] = [
        parallelNode({ branches: [{ id: 'a', entry_node_id: 'llm-1' }], next_node_id: 'ghost' }),
        llmNode({ next_node_id: null }),
      ];
      const errors = validateGraphStructure(reasoning(graph, { entry_node_id: 'parallel-1' }));
      expect(errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_GRAPH_REF_UNKNOWN', field: 'parallel-1/next_node_id' })]),
      );
    });

    it('flags join_policy quorum without a valid quorum_n', () => {
      const graph: GraphNode[] = [
        parallelNode({ branches: [{ id: 'a', entry_node_id: 'llm-1' }], join_policy: 'quorum' }),
        llmNode({ next_node_id: null }),
      ];
      const errors = validateGraphStructure(reasoning(graph, { entry_node_id: 'parallel-1' }));
      expect(errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_GRAPH_QUORUM_N_INVALID', field: 'parallel-1/quorum_n' })]),
      );
    });

    it('flags quorum_n greater than the branch count', () => {
      const graph: GraphNode[] = [
        parallelNode({ branches: [{ id: 'a', entry_node_id: 'llm-1' }], join_policy: 'quorum', quorum_n: 5 }),
        llmNode({ next_node_id: null }),
      ];
      const errors = validateGraphStructure(reasoning(graph, { entry_node_id: 'parallel-1' }));
      expect(errors.some((e) => e.code === 'CONFIG_GRAPH_QUORUM_N_INVALID')).toBe(true);
    });

    it('accepts join_policy quorum with a valid quorum_n', () => {
      const graph: GraphNode[] = [
        parallelNode({
          branches: [
            { id: 'a', entry_node_id: 'llm-1' },
            { id: 'b', entry_node_id: 'llm-1' },
          ],
          join_policy: 'quorum',
          quorum_n: 1,
        }),
        llmNode({ next_node_id: null }),
      ];
      expect(validateGraphStructure(reasoning(graph, { entry_node_id: 'parallel-1' }))).toEqual([]);
    });

    it('a fully-valid Loop node produces zero errors', () => {
      const graph: GraphNode[] = [loopNode({ next_node_id: 'end-1' }), llmNode({ next_node_id: null }), endNode()];
      expect(validateGraphStructure(reasoning(graph, { entry_node_id: 'loop-1' }))).toEqual([]);
    });

    it('flags a dangling Loop body_entry_node_id', () => {
      const graph: GraphNode[] = [loopNode({ body_entry_node_id: 'ghost' })];
      const errors = validateGraphStructure(reasoning(graph, { entry_node_id: 'loop-1' }));
      expect(errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_GRAPH_REF_UNKNOWN', field: 'loop-1/body_entry_node_id' })]),
      );
    });

    it('flags a dangling Loop next_node_id', () => {
      const graph: GraphNode[] = [loopNode({ next_node_id: 'ghost' }), llmNode({ next_node_id: null })];
      const errors = validateGraphStructure(reasoning(graph, { entry_node_id: 'loop-1' }));
      expect(errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_GRAPH_REF_UNKNOWN', field: 'loop-1/next_node_id' })]),
      );
    });
  });

  describe('Phase 15 (BL-058/059/060) — Sub-agent/Handoff/State referential integrity + State value requirement', () => {
    it('flags a dangling Sub-agent next_node_id', () => {
      const errors = validateGraphStructure(reasoning([subAgentNode({ next_node_id: 'ghost' })]));
      expect(errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_GRAPH_REF_UNKNOWN', field: 'subagent-1/next_node_id' })]),
      );
    });

    it('a Handoff node has no next_node_id to check — never flags CONFIG_GRAPH_REF_UNKNOWN for it', () => {
      const errors = validateGraphStructure(reasoning([handoffNode()]));
      expect(errors.filter((e) => e.field?.startsWith('handoff-1'))).toEqual([]);
    });

    it('flags a dangling State next_node_id', () => {
      const errors = validateGraphStructure(reasoning([stateNode({ next_node_id: 'ghost' })]));
      expect(errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_GRAPH_REF_UNKNOWN', field: 'state-1/next_node_id' })]),
      );
    });

    it('flags a write-mode State node with no value (R-H1-style "required only in one mode" check)', () => {
      const errors = validateGraphStructure(reasoning([stateNode({ mode: 'write', value: undefined })]));
      expect(errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'CONFIG_STATE_VALUE_REQUIRED', field: 'state-1/value' })]),
      );
    });

    it('flags a write-mode State node with a blank value', () => {
      const errors = validateGraphStructure(reasoning([stateNode({ mode: 'write', value: '   ' })]));
      expect(errors.some((e) => e.code === 'CONFIG_STATE_VALUE_REQUIRED')).toBe(true);
    });

    it('does not require a value for a read-mode State node', () => {
      const errors = validateGraphStructure(reasoning([stateNode({ mode: 'read', value: undefined })]));
      expect(errors.some((e) => e.code === 'CONFIG_STATE_VALUE_REQUIRED')).toBe(false);
    });

    it('accepts a fully-specified write-mode State node', () => {
      const errors = validateGraphStructure(reasoning([stateNode()]));
      expect(errors).toEqual([]);
    });
  });
});
