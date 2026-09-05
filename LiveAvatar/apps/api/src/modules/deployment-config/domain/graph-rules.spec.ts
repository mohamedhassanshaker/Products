import { validateGraphRules, validateLoopGuards, validateNoCycles } from './graph-rules';
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

function reasoning(graph: GraphNode[], overrides: Partial<Reasoning> = {}): Reasoning {
  return { graph, entry_node_id: graph[0]?.id ?? 'missing', background_entry_node_ids: [], turn_budget_ms: 3000, ...overrides };
}

describe('validateLoopGuards (V-2, R-G4)', () => {
  it('accepts a Loop node with all three guards positive', () => {
    const errors = validateLoopGuards(reasoning([loopNode(), llmNode()]));
    expect(errors).toEqual([]);
  });

  it('rejects max_iterations < 1, independently of the other guards', () => {
    const errors = validateLoopGuards(reasoning([loopNode({ max_iterations: 0 }), llmNode()]));
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('CONFIG_LOOP_GUARD_INVALID');
    expect(errors[0].field).toBe('loop-1/max_iterations');
  });

  it('rejects a negative max_iterations too', () => {
    const errors = validateLoopGuards(reasoning([loopNode({ max_iterations: -1 }), llmNode()]));
    expect(errors.map((e) => e.field)).toEqual(['loop-1/max_iterations']);
  });

  it('rejects max_duration_ms < 1, independently of the other guards', () => {
    const errors = validateLoopGuards(reasoning([loopNode({ max_duration_ms: 0 }), llmNode()]));
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('loop-1/max_duration_ms');
  });

  it('rejects a negative max_cost, but allows exactly zero', () => {
    const negative = validateLoopGuards(reasoning([loopNode({ max_cost: -1 }), llmNode()]));
    expect(negative).toHaveLength(1);
    expect(negative[0].field).toBe('loop-1/max_cost');

    const zero = validateLoopGuards(reasoning([loopNode({ max_cost: 0 }), llmNode()]));
    expect(zero).toEqual([]);
  });

  it('reports every violated guard on the same node, not just the first', () => {
    const errors = validateLoopGuards(reasoning([loopNode({ max_iterations: 0, max_duration_ms: 0, max_cost: -5 }), llmNode()]));
    expect(errors).toHaveLength(3);
    expect(errors.map((e) => e.field).sort()).toEqual(['loop-1/max_cost', 'loop-1/max_duration_ms', 'loop-1/max_iterations']);
  });

  it('ignores non-Loop nodes entirely', () => {
    expect(validateLoopGuards(reasoning([llmNode()]))).toEqual([]);
  });

  it('returns no errors when reasoning is undefined or has no graph', () => {
    expect(validateLoopGuards(undefined)).toEqual([]);
  });
});

describe('validateNoCycles (V-4, R-G5)', () => {
  it('accepts an acyclic linear chain', () => {
    const graph = [llmNode({ next_node_id: 'end-1' }), endNode()];
    expect(validateNoCycles(reasoning(graph))).toEqual([]);
  });

  it('accepts Router branching (a DAG diamond is not a cycle)', () => {
    const graph = [
      routerNode({ branches: [{ condition: 'utterance == "x"', next_node_id: 'end-1' }], default_next_node_id: 'end-1' }),
      endNode(),
    ];
    expect(validateNoCycles(reasoning(graph, { entry_node_id: 'router-1' }))).toEqual([]);
  });

  it('rejects a Router branch pointing back at an earlier node — a real cycle outside any Loop node', () => {
    const graph = [
      routerNode({ id: 'router-1', branches: [{ condition: 'utterance == "x"', next_node_id: 'llm-1' }], default_next_node_id: 'llm-1' }),
      llmNode({ next_node_id: 'router-1' }),
    ];
    const errors = validateNoCycles(reasoning(graph, { entry_node_id: 'router-1' }));
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('CONFIG_GRAPH_CYCLE_DETECTED');
    // Attaches to a specific node card (see this function's own doc comment
    // on why a bare `field` is required for `errorsByNode()` to pick it up).
    expect(errors[0].field).toBeDefined();
  });

  it('accepts a valid Loop node (body is a single-entry chain under this schema’s representation, never a literal graph cycle)', () => {
    const graph = [loopNode({ next_node_id: 'end-1' }), llmNode({ next_node_id: null }), endNode()];
    expect(validateNoCycles(reasoning(graph, { entry_node_id: 'loop-1' }))).toEqual([]);
  });

  it('rejects a cycle reachable only from inside an otherwise-unreached Parallel branch', () => {
    const graph = [
      llmNode({ id: 'main', next_node_id: null }),
      parallelNode({ branches: [{ id: 'a', entry_node_id: 'tool-cycle' }], next_node_id: null }),
      routerNode({ id: 'tool-cycle', branches: [{ condition: 'utterance == "x"', next_node_id: 'tool-cycle-2' }], default_next_node_id: 'tool-cycle-2' }),
      routerNode({ id: 'tool-cycle-2', branches: [{ condition: 'utterance == "y"', next_node_id: 'tool-cycle' }], default_next_node_id: 'tool-cycle' }),
    ];
    const errors = validateNoCycles(reasoning(graph, { entry_node_id: 'main' }));
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('CONFIG_GRAPH_CYCLE_DETECTED');
  });

  it('does not hang on a large defensively-bounded graph', () => {
    const graph: GraphNode[] = [];
    for (let i = 0; i < 200; i++) {
      graph.push(llmNode({ id: `llm-${i}`, next_node_id: i < 199 ? `llm-${i + 1}` : null }));
    }
    const errors = validateNoCycles(reasoning(graph, { entry_node_id: 'llm-0' }));
    expect(errors).toEqual([]);
  });
});

describe('validateGraphRules (V-2 + V-4 combined)', () => {
  it('a valid Loop/Parallel graph passes both checks', () => {
    const graph = [
      parallelNode({ branches: [{ id: 'a', entry_node_id: 'loop-1' }], next_node_id: 'end-1' }),
      loopNode({ next_node_id: null }),
      llmNode({ next_node_id: null }),
      endNode(),
    ];
    expect(validateGraphRules(reasoning(graph, { entry_node_id: 'parallel-1' }))).toEqual([]);
  });

  it('concatenates violations from both V-2 and V-4', () => {
    const graph = [
      routerNode({ id: 'router-1', branches: [{ condition: 'utterance == "x"', next_node_id: 'loop-1' }], default_next_node_id: 'loop-1' }),
      loopNode({ max_iterations: 0, next_node_id: 'router-1' }), // both a bad guard AND a cycle (loop-1 -> router-1 -> loop-1)
      llmNode({ next_node_id: null }),
    ];
    const errors = validateGraphRules(reasoning(graph, { entry_node_id: 'router-1' }));
    expect(errors.some((e) => e.code === 'CONFIG_LOOP_GUARD_INVALID')).toBe(true);
    expect(errors.some((e) => e.code === 'CONFIG_GRAPH_CYCLE_DETECTED')).toBe(true);
  });
});
