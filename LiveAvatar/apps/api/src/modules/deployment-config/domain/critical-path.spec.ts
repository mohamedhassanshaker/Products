import { computeCriticalPath } from './critical-path';
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

function retrieveNode(overrides: Partial<Extract<GraphNode, { type: 'retrieve' }>> = {}): Extract<GraphNode, { type: 'retrieve' }> {
  return {
    id: 'retrieve-1',
    type: 'retrieve',
    name: 'Retrieve',
    lane: 'foreground',
    on_error: edge,
    on_deadline: edge,
    source_refs: [],
    top_k: 5,
    budget_ms: 400,
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
    branches: [{ id: 'branch-a', entry_node_id: 'tool-1' }],
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

function hitlNode(overrides: Partial<Extract<GraphNode, { type: 'hitl' }>> = {}): Extract<GraphNode, { type: 'hitl' }> {
  return {
    id: 'hitl-1',
    type: 'hitl',
    name: 'Approve refund',
    lane: 'foreground',
    on_error: edge,
    on_deadline: edge,
    gate_id: 'gate-1',
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

describe('computeCriticalPath', () => {
  it('a single LLM node graph terminating at a null next_node_id is one path costing the LLM default (900ms)', () => {
    const report = computeCriticalPath(reasoning([llmNode()]));
    expect(report.paths).toHaveLength(1);
    expect(report.paths[0].total_ms).toBe(900);
    expect(report.critical_path_ms).toBe(900);
    expect(report.over_budget).toBe(false);
  });

  it('a linear LLM -> Tool -> Speak -> End chain sums every node default (900+400+0+0=1300)', () => {
    const graph = [
      llmNode({ next_node_id: 'tool-1' }),
      toolNode({ next_node_id: 'speak-1' }),
      speakNode({ next_node_id: 'end-1' }),
      endNode(),
    ];
    const report = computeCriticalPath(reasoning(graph));
    expect(report.paths).toHaveLength(1);
    expect(report.paths[0].total_ms).toBe(1300);
    expect(report.paths[0].steps.map((s) => s.node_id)).toEqual(['llm-1', 'tool-1', 'speak-1', 'end-1']);
    expect(report.critical_path_ms).toBe(1300);
  });

  it("a Retrieve node's cost is its own budget_ms (Phase 12b — a real worst-case bound, not a stub)", () => {
    const graph = [retrieveNode({ budget_ms: 400, next_node_id: 'end-1' }), endNode()];
    const report = computeCriticalPath(reasoning(graph, { entry_node_id: 'retrieve-1' }));
    expect(report.critical_path_ms).toBe(400);
  });

  describe('Router branching — enumerates one path per branch (+ the default)', () => {
    it('produces one path per branch and the default branch, each with its own total', () => {
      const graph = [
        routerNode({
          branches: [
            { condition: 'utterance == "a"', next_node_id: 'tool-1' },
            { condition: 'utterance == "b"', next_node_id: 'end-1' },
          ],
          default_next_node_id: 'llm-1',
        }),
        toolNode({ id: 'tool-1', next_node_id: 'end-1' }),
        llmNode({ id: 'llm-1', next_node_id: 'end-1' }),
        endNode(),
      ];
      const report = computeCriticalPath(reasoning(graph, { entry_node_id: 'router-1' }));

      expect(report.paths).toHaveLength(3);
      // Router(150) + Tool(400) + End(0) = 550
      expect(report.paths.find((p) => p.steps.some((s) => s.node_id === 'tool-1'))?.total_ms).toBe(550);
      // Router(150) + End(0) = 150 (the "b" branch goes straight to end-1)
      expect(report.paths.filter((p) => p.steps.length === 2).some((p) => p.total_ms === 150)).toBe(true);
      // Router(150) + LLM(900) + End(0) = 1050 (the default branch)
      expect(report.paths.find((p) => p.steps.some((s) => s.node_id === 'llm-1'))?.total_ms).toBe(1050);

      // The critical path is the longest of the three.
      expect(report.critical_path_ms).toBe(1050);
    });

    it('a Router branch with no further nodes (points straight at End) is a legitimate terminal path', () => {
      const graph = [
        routerNode({ branches: [{ condition: 'utterance == "x"', next_node_id: 'end-1' }], default_next_node_id: 'end-1' }),
        endNode(),
      ];
      const report = computeCriticalPath(reasoning(graph, { entry_node_id: 'router-1' }));
      // Both the matching branch and the default point at the same terminal — two enumerated paths, same shape.
      expect(report.paths).toHaveLength(2);
      expect(report.paths.every((p) => p.total_ms === 150)).toBe(true);
    });
  });

  describe('over/under budget', () => {
    it('flags over_budget on the report and the offending path when the critical path exceeds turn_budget_ms', () => {
      const graph = [llmNode({ next_node_id: 'tool-1' }), toolNode({ next_node_id: null })];
      const report = computeCriticalPath(reasoning(graph, { turn_budget_ms: 1000 }));
      expect(report.critical_path_ms).toBe(1300); // 900 + 400
      expect(report.over_budget).toBe(true);
      expect(report.paths[0].over_budget).toBe(true);
    });

    it('does not flag over_budget when the critical path is within turn_budget_ms', () => {
      const report = computeCriticalPath(reasoning([llmNode()], { turn_budget_ms: 3000 }));
      expect(report.over_budget).toBe(false);
      expect(report.paths[0].over_budget).toBe(false);
    });

    it('a path exactly equal to the budget is not over_budget (strictly greater-than)', () => {
      const report = computeCriticalPath(reasoning([llmNode()], { turn_budget_ms: 900 }));
      expect(report.over_budget).toBe(false);
    });
  });

  describe('background-lane exclusion (R-G14)', () => {
    it('a background-lane node contributes zero cost even though it is still part of the enumerated path', () => {
      const graph = [
        llmNode({ next_node_id: 'tool-1' }),
        toolNode({ lane: 'background', next_node_id: 'end-1' }),
        endNode(),
      ];
      const report = computeCriticalPath(reasoning(graph));
      // LLM(900) + Tool(0, background) + End(0) = 900, not 1300.
      expect(report.critical_path_ms).toBe(900);
      const step = report.paths[0].steps.find((s) => s.node_id === 'tool-1');
      expect(step?.cost_ms).toBe(0);
      expect(step?.lane).toBe('background');
    });

    it('an all-foreground graph is unaffected (sanity check for the exclusion above)', () => {
      const graph = [llmNode({ next_node_id: 'tool-1' }), toolNode({ next_node_id: null })];
      const report = computeCriticalPath(reasoning(graph));
      expect(report.critical_path_ms).toBe(1300);
    });
  });

  describe('Parallel node cost (Phase 11, BL-042)', () => {
    it("join: all -> the slowest branch's cost, not the sum (§A3.7)", () => {
      const graph = [
        parallelNode({
          branches: [
            { id: 'branch-order', entry_node_id: 'tool-1' }, // 400ms
            { id: 'branch-llm', entry_node_id: 'llm-1' }, // 900ms
          ],
          join_policy: 'all',
          next_node_id: 'end-1',
        }),
        toolNode({ next_node_id: null }),
        llmNode({ next_node_id: null }),
        endNode(),
      ];
      const report = computeCriticalPath(reasoning(graph, { entry_node_id: 'parallel-1' }));
      // Parallel(900, the slower branch) + End(0) = 900 — not 400+900=1300.
      expect(report.critical_path_ms).toBe(900);
    });

    it('join: all_settled -> also the slowest branch', () => {
      const graph = [
        parallelNode({
          branches: [
            { id: 'a', entry_node_id: 'tool-1' },
            { id: 'b', entry_node_id: 'llm-1' },
          ],
          join_policy: 'all_settled',
          next_node_id: null,
        }),
        toolNode({ next_node_id: null }),
        llmNode({ next_node_id: null }),
      ];
      const report = computeCriticalPath(reasoning(graph, { entry_node_id: 'parallel-1' }));
      expect(report.critical_path_ms).toBe(900);
    });

    it('join: first_success -> the fastest branch (optimistic estimate)', () => {
      const graph = [
        parallelNode({
          branches: [
            { id: 'a', entry_node_id: 'tool-1' },
            { id: 'b', entry_node_id: 'llm-1' },
          ],
          join_policy: 'first_success',
          next_node_id: null,
        }),
        toolNode({ next_node_id: null }),
        llmNode({ next_node_id: null }),
      ];
      const report = computeCriticalPath(reasoning(graph, { entry_node_id: 'parallel-1' }));
      expect(report.critical_path_ms).toBe(400);
    });

    it('join: quorum(n) -> the n-th fastest branch', () => {
      const graph = [
        parallelNode({
          branches: [
            { id: 'a', entry_node_id: 'tool-1' }, // 400ms
            { id: 'b', entry_node_id: 'router-1' }, // 150ms (its own default -> end-1, 0ms) = 150
            { id: 'c', entry_node_id: 'llm-1' }, // 900ms
          ],
          join_policy: 'quorum',
          quorum_n: 2,
          next_node_id: null,
        }),
        toolNode({ next_node_id: null }),
        routerNode({ branches: [], default_next_node_id: 'end-1' }),
        llmNode({ next_node_id: null }),
        endNode(),
      ];
      const report = computeCriticalPath(reasoning(graph, { entry_node_id: 'parallel-1' }));
      // Sorted ascending: [150, 400, 900] — n=2 -> index 1 -> 400.
      expect(report.critical_path_ms).toBe(400);
    });

    it('recurses into a branch containing a nested Router (max over the fan-out)', () => {
      const graph = [
        parallelNode({
          branches: [{ id: 'a', entry_node_id: 'router-1' }],
          join_policy: 'all',
          next_node_id: null,
        }),
        routerNode({
          branches: [{ condition: 'utterance == "x"', next_node_id: 'llm-1' }],
          default_next_node_id: 'tool-1',
        }),
        llmNode({ next_node_id: null }), // 900ms
        toolNode({ next_node_id: null }), // 400ms
      ];
      const report = computeCriticalPath(reasoning(graph, { entry_node_id: 'parallel-1' }));
      // Router(150) + max(LLM 900, Tool 400) = 1050.
      expect(report.critical_path_ms).toBe(1050);
    });

    it('a background-lane Parallel node contributes zero cost regardless of its branches', () => {
      const graph = [parallelNode({ lane: 'background', branches: [{ id: 'a', entry_node_id: 'llm-1' }], next_node_id: null }), llmNode({ next_node_id: null })];
      const report = computeCriticalPath(reasoning(graph, { entry_node_id: 'parallel-1' }));
      expect(report.critical_path_ms).toBe(0);
    });

    it('UC-G1 step 8 — sequential-to-parallel recovers budget headroom end to end', () => {
      // Sequential: Tool(400) + Tool(400) + LLM(900) = 1700ms.
      const sequential = reasoning([
        toolNode({ id: 'tool-a', next_node_id: 'tool-b' }),
        toolNode({ id: 'tool-b', next_node_id: 'llm-1' }),
        llmNode({ next_node_id: null }),
      ], { entry_node_id: 'tool-a', turn_budget_ms: 1500 });
      expect(computeCriticalPath(sequential).critical_path_ms).toBe(1700);
      expect(computeCriticalPath(sequential).over_budget).toBe(true);

      // Parallelised: max(Tool 400, Tool 400) + LLM(900) = 1300ms — back under budget.
      const parallelised = reasoning([
        parallelNode({
          branches: [
            { id: 'a', entry_node_id: 'tool-a' },
            { id: 'b', entry_node_id: 'tool-b' },
          ],
          join_policy: 'all',
          next_node_id: 'llm-1',
        }),
        toolNode({ id: 'tool-a', next_node_id: null }),
        toolNode({ id: 'tool-b', next_node_id: null }),
        llmNode({ next_node_id: null }),
      ], { entry_node_id: 'parallel-1', turn_budget_ms: 1500 });
      const parallelReport = computeCriticalPath(parallelised);
      expect(parallelReport.critical_path_ms).toBe(1300);
      expect(parallelReport.over_budget).toBe(false);
    });
  });

  describe('Loop node cost (Phase 11, BL-043)', () => {
    it('bounded by body cost × max_iterations when that is the tighter bound', () => {
      const graph = [loopNode({ max_iterations: 3, max_duration_ms: 10000, next_node_id: null }), llmNode({ next_node_id: null })];
      const report = computeCriticalPath(reasoning(graph, { entry_node_id: 'loop-1' }));
      // body cost (900) * 3 iterations = 2700, well under the 10000ms duration cap.
      expect(report.critical_path_ms).toBe(2700);
    });

    it('bounded by max_duration_ms when that is the tighter bound', () => {
      const graph = [loopNode({ max_iterations: 100, max_duration_ms: 1000, next_node_id: null }), llmNode({ next_node_id: null })];
      const report = computeCriticalPath(reasoning(graph, { entry_node_id: 'loop-1' }));
      // body cost (900) * 100 = 90000, capped down to the 1000ms duration guard.
      expect(report.critical_path_ms).toBe(1000);
    });

    it('recurses into a body containing a nested chain', () => {
      const graph = [
        loopNode({ body_entry_node_id: 'llm-1', max_iterations: 2, max_duration_ms: 10000, next_node_id: 'end-1' }),
        llmNode({ next_node_id: 'tool-1' }),
        toolNode({ next_node_id: null }),
        endNode(),
      ];
      const report = computeCriticalPath(reasoning(graph, { entry_node_id: 'loop-1' }));
      // body = LLM(900) + Tool(400) = 1300; * 2 iterations = 2600; + End(0) = 2600.
      expect(report.critical_path_ms).toBe(2600);
    });

    it('a background-lane Loop node contributes zero cost', () => {
      const graph = [loopNode({ lane: 'background', next_node_id: null }), llmNode({ next_node_id: null })];
      const report = computeCriticalPath(reasoning(graph, { entry_node_id: 'loop-1' }));
      expect(report.critical_path_ms).toBe(0);
    });
  });

  describe('defensive behavior on a structurally malformed graph', () => {
    it('a dangling entry_node_id produces zero paths rather than throwing', () => {
      const report = computeCriticalPath(reasoning([llmNode()], { entry_node_id: 'does-not-exist' }));
      expect(report.paths).toEqual([]);
      expect(report.critical_path_ms).toBe(0);
      expect(report.over_budget).toBe(false);
    });

    it('a Router cycle (branch pointing back at an already-visited node) terminates instead of looping forever', () => {
      const graph = [
        routerNode({
          id: 'router-1',
          branches: [{ condition: 'utterance == "x"', next_node_id: 'router-2' }],
          default_next_node_id: 'router-2',
        }),
        routerNode({
          id: 'router-2',
          branches: [{ condition: 'utterance == "y"', next_node_id: 'router-1' }],
          default_next_node_id: 'router-1',
        }),
      ];
      const report = computeCriticalPath(reasoning(graph, { entry_node_id: 'router-1' }));
      // The cycle is abandoned rather than fabricating an infinite/complete path.
      expect(report.paths).toEqual([]);
      expect(report.critical_path_ms).toBe(0);
    });
  });

  describe('Phase 14 — HITL (R-H4: a blocking gate marks its path unbounded, never estimated)', () => {
    it('a HITL node contributes zero numeric cost and marks its own step + path unbounded', () => {
      const report = computeCriticalPath(reasoning([hitlNode()]));
      expect(report.paths).toHaveLength(1);
      expect(report.paths[0].steps[0].unbounded).toBe(true);
      expect(report.paths[0].unbounded).toBe(true);
      expect(report.paths[0].total_ms).toBe(0);
    });

    it('an unbounded path never reports over_budget from its (necessarily incomplete) numeric sum', () => {
      const graph = [llmNode({ next_node_id: 'hitl-1' }), hitlNode()];
      const report = computeCriticalPath(reasoning(graph, { turn_budget_ms: 1 }));
      expect(report.paths[0].unbounded).toBe(true);
      expect(report.paths[0].over_budget).toBe(false);
    });

    it('has_unbounded_path is true when any enumerated path passes through a HITL node', () => {
      const report = computeCriticalPath(reasoning([hitlNode()]));
      expect(report.has_unbounded_path).toBe(true);
    });

    it('has_unbounded_path is false for a graph with no HITL node', () => {
      const report = computeCriticalPath(reasoning([llmNode()]));
      expect(report.has_unbounded_path).toBe(false);
    });

    it('critical_path_ms is computed over bounded paths only, ignoring an unbounded sibling path', () => {
      const graph = [
        routerNode({
          branches: [{ condition: 'utterance == "x"', next_node_id: 'hitl-1' }],
          default_next_node_id: 'llm-1',
        }),
        hitlNode(),
        llmNode(),
      ];
      const report = computeCriticalPath(reasoning(graph, { entry_node_id: 'router-1' }));
      expect(report.paths).toHaveLength(2);
      // The bounded (router -> llm) path's cost (150 + 900 = 1050) is what
      // drives critical_path_ms — the unbounded (router -> hitl) path is
      // excluded from that max, not silently treated as "0ms and therefore
      // never the critical path" by accident.
      expect(report.critical_path_ms).toBe(1050);
      expect(report.has_unbounded_path).toBe(true);
    });

    it('when every path is unbounded, critical_path_ms falls back to 0 rather than throwing', () => {
      const report = computeCriticalPath(reasoning([hitlNode()], { turn_budget_ms: 3000 }));
      expect(report.critical_path_ms).toBe(0);
      expect(report.over_budget).toBe(false);
      expect(report.has_unbounded_path).toBe(true);
    });
  });

  describe('Phase 15 (BL-058/059/060) — Sub-agent/Handoff/State cost strategies', () => {
    it('a Sub-agent node costs exactly its own budget_ms, a real worst-case bound (not a code-constant estimate)', () => {
      const report = computeCriticalPath(reasoning([subAgentNode({ budget_ms: 2500 })]));
      expect(report.paths[0].total_ms).toBe(2500);
      expect(report.paths[0].unbounded).toBe(false);
    });

    it('a Handoff node is terminal (no continuation) and costs 0', () => {
      const report = computeCriticalPath(reasoning([handoffNode()]));
      expect(report.paths).toHaveLength(1);
      expect(report.paths[0].total_ms).toBe(0);
      expect(report.paths[0].steps).toHaveLength(1);
    });

    it('a State node costs 0 (an in-memory read/write is negligible)', () => {
      const report = computeCriticalPath(reasoning([stateNode()]));
      expect(report.paths[0].total_ms).toBe(0);
    });

    it('a Sub-agent -> State -> Handoff chain sums only the Sub-agent budget', () => {
      const graph = [
        subAgentNode({ next_node_id: 'state-1', budget_ms: 3000 }),
        stateNode({ next_node_id: 'handoff-1' }),
        handoffNode(),
      ];
      const report = computeCriticalPath(reasoning(graph));
      expect(report.critical_path_ms).toBe(3000);
      expect(report.paths[0].unbounded).toBe(false);
    });
  });
});
