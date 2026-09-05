import type { GraphNode, Reasoning } from '@liveavatar/contracts';
import type { TenantRepositoryPort } from '../../tenants';
import type { ToolDefinitionRepositoryPort, ToolInvokerPort } from '../../tools';
import type { GateResult, ValidateConfigUseCase } from './validate-config.use-case';
import { TestCallGraphUseCase } from './test-call-graph.use-case';

const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };

function makeTenant(overrides: Record<string, unknown> = {}) {
  return { id: 'tenant-1', name: 'Acme', slug: 'acme', ...overrides };
}

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
    branches: [{ condition: 'utterance == "weather"', next_node_id: 'tool-1' }],
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

function reasoning(graph: GraphNode[], overrides: Partial<Reasoning> = {}): Reasoning {
  return { graph, entry_node_id: graph[0]?.id ?? 'missing', background_entry_node_ids: [], turn_budget_ms: 3000, ...overrides };
}

function gateResult(reasoningBlock: Reasoning | undefined, overrides: Partial<GateResult> = {}): GateResult {
  return { errors: [], schemaValid: true, config: { reasoning: reasoningBlock }, ...overrides };
}

describe('TestCallGraphUseCase', () => {
  function make(tenant: unknown = makeTenant()) {
    const tenants = { findById: jest.fn().mockResolvedValue(tenant) } as unknown as jest.Mocked<TenantRepositoryPort>;
    const toolDefs = { findByApiRef: jest.fn() } as unknown as jest.Mocked<ToolDefinitionRepositoryPort>;
    const toolInvoker = { invoke: jest.fn() } as unknown as jest.Mocked<ToolInvokerPort>;
    const validator = { runSchemaGate: jest.fn() } as unknown as jest.Mocked<Pick<ValidateConfigUseCase, 'runSchemaGate'>>;
    const useCase = new TestCallGraphUseCase(tenants, toolDefs, toolInvoker, validator as unknown as ValidateConfigUseCase);
    return { useCase, tenants, toolDefs, toolInvoker, validator };
  }

  it('404s an unknown tenant', async () => {
    const { useCase } = make(null);
    await expect(useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' })).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
    });
  });

  it('404s (not 403) an admin not assigned to this tenant', async () => {
    const { useCase } = make(makeTenant());
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other-tenant'] };
    await expect(useCase.execute(unassigned, 'tenant-1', { config: {}, utterance: 'hi' })).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
    });
  });

  it('returns ok:false with Gate A errors and no nodes for a schema-invalid config', async () => {
    const { useCase, validator } = make();
    validator.runSchemaGate.mockReturnValue(
      gateResult(undefined, { schemaValid: false, errors: [{ code: 'CONFIG_YAML_UNKNOWN_KEY', message: 'bad key' }] }),
    );
    const result = await useCase.execute(actor, 'tenant-1', { config: { bogus: true }, utterance: 'hi' });
    expect(result).toEqual({
      ok: false,
      final_text: null,
      nodes: [],
      errors: [{ code: 'CONFIG_YAML_UNKNOWN_KEY', message: 'bad key' }],
    });
  });

  it('returns ok:false when the config is schema-valid but carries no reasoning block at all', async () => {
    const { useCase, validator } = make();
    validator.runSchemaGate.mockReturnValue(gateResult(undefined));
    const result = await useCase.execute(actor, 'tenant-1', { config: { version: 1 }, utterance: 'hi' });
    expect(result.ok).toBe(false);
    expect(result.nodes).toEqual([]);
  });

  it('the implicit-speak-then-end default case: a bare single-LLM-node graph speaks the LLM output with no explicit Speak/End node', async () => {
    const { useCase, validator } = make();
    validator.runSchemaGate.mockReturnValue(gateResult(reasoning([llmNode()])));
    const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hello there' });
    expect(result.ok).toBe(true);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({ node_id: 'llm-1', node_type: 'llm', status: 'complete', simulated: true });
    expect(result.final_text).toContain('hello there');
  });

  it('an explicit Speak node (llm_output mode) after an LLM node speaks the simulated LLM text', async () => {
    const { useCase, validator } = make();
    validator.runSchemaGate.mockReturnValue(
      gateResult(reasoning([llmNode({ next_node_id: 'speak-1' }), speakNode({ mode: 'llm_output' })]), {}),
    );
    const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
    expect(result.ok).toBe(true);
    expect(result.final_text).toContain('hi');
    expect(result.nodes.map((n) => n.node_id)).toEqual(['llm-1', 'speak-1']);
  });

  it('an explicit Speak node (literal mode) speaks its own fixed text, ignoring the LLM output', async () => {
    const { useCase, validator } = make();
    validator.runSchemaGate.mockReturnValue(
      gateResult(reasoning([llmNode({ next_node_id: 'speak-1' }), speakNode({ mode: 'literal', text: 'Fixed reply' })])),
    );
    const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
    expect(result.final_text).toBe('Fixed reply');
  });

  it('an End node terminates the walk with no final_text change', async () => {
    const { useCase, validator } = make();
    validator.runSchemaGate.mockReturnValue(gateResult(reasoning([endNode()])));
    const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
    expect(result.ok).toBe(true);
    expect(result.final_text).toBeNull();
    expect(result.nodes).toEqual([{ node_id: 'end-1', node_type: 'end', lane: 'foreground', status: 'complete', simulated: false, summary: 'Turn ended.' }]);
  });

  describe('Router node', () => {
    it('a matching branch routes to that branch\'s target, not the default', async () => {
      const { useCase, validator } = make();
      validator.runSchemaGate.mockReturnValue(
        gateResult(
          reasoning([
            routerNode({ branches: [{ condition: 'utterance == "weather"', next_node_id: 'tool-1' }], default_next_node_id: 'llm-1' }),
            toolNode({ next_node_id: null }),
            llmNode(),
          ]),
        ),
      );
      const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'weather' });
      expect(result.nodes[0]).toMatchObject({ node_id: 'router-1', status: 'complete', summary: expect.stringContaining('matched') });
      expect(result.nodes[1].node_id).toBe('tool-1');
    });

    it('no branch matches: falls through to default_next_node_id', async () => {
      const { useCase, validator } = make();
      validator.runSchemaGate.mockReturnValue(
        gateResult(
          reasoning([
            routerNode({ branches: [{ condition: 'utterance == "weather"', next_node_id: 'tool-1' }], default_next_node_id: 'llm-1' }),
            toolNode({ next_node_id: null }),
            llmNode(),
          ]),
        ),
      );
      const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'something else' });
      expect(result.nodes[0]).toMatchObject({ node_id: 'router-1', status: 'complete', summary: 'No branch matched — took the default.' });
      expect(result.nodes[1].node_id).toBe('llm-1');
    });

    it('a malformed condition surfaces as a failed router node result, not a crash, and resolves the on_error goto edge', async () => {
      const { useCase, validator } = make();
      validator.runSchemaGate.mockReturnValue(
        gateResult(
          reasoning([
            routerNode({
              branches: [{ condition: 'utterance > "x"', next_node_id: 'llm-1' }],
              default_next_node_id: 'llm-1',
              on_error: { action: 'goto', target_node_id: 'llm-1' },
            }),
            llmNode(),
          ]),
        ),
      );
      const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
      expect(result.ok).toBe(true); // the overall call still completes
      expect(result.nodes[0]).toMatchObject({ node_id: 'router-1', node_type: 'router', status: 'failed', simulated: false });
      // Took router-1's on_error goto ("llm-1"), not default_next_node_id (which happens to also be "llm-1" here — see the next test for a graph where they differ).
      expect(result.nodes[1]?.node_id).toBe('llm-1');
    });

    it('a malformed condition with no goto on_error stops the walk instead of falling through to default_next_node_id (Phase 10 fix, Phase 9 finding #2)', async () => {
      const { useCase, validator } = make();
      validator.runSchemaGate.mockReturnValue(
        gateResult(
          reasoning([
            routerNode({
              branches: [{ condition: 'utterance > "x"', next_node_id: 'llm-1' }],
              default_next_node_id: 'llm-1',
              // default on_error: degrade — no goto configured.
            }),
            llmNode(),
          ]),
        ),
      );
      const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
      expect(result.ok).toBe(true);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]).toMatchObject({ node_id: 'router-1', status: 'failed' });
    });
  });

  describe('Tool node', () => {
    it('an unknown api_ref fails the node without throwing', async () => {
      const { useCase, validator, toolDefs, toolInvoker } = make();
      validator.runSchemaGate.mockReturnValue(gateResult(reasoning([toolNode({ api_ref: 'ghost-api' })])));
      toolDefs.findByApiRef.mockResolvedValue(null);
      const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
      expect(result.ok).toBe(true);
      expect(result.nodes[0]).toMatchObject({ node_id: 'tool-1', node_type: 'tool', status: 'failed', simulated: false });
      expect(result.nodes[0].summary).toContain('ghost-api');
      expect(toolInvoker.invoke).not.toHaveBeenCalled();
    });

    it('a known api_ref makes a real call via ToolInvokerPort and reports complete on success', async () => {
      const { useCase, validator, toolDefs, toolInvoker } = make();
      const definition = { id: 'tool-def-1', tenantId: 'tenant-1', apiRef: 'weather-api', name: 'Weather' };
      validator.runSchemaGate.mockReturnValue(
        gateResult(reasoning([toolNode({ argument_mapping: { q: '$utterance' } })])),
      );
      toolDefs.findByApiRef.mockResolvedValue(definition as never);
      toolInvoker.invoke.mockResolvedValue({ ok: true, status: 200, durationMs: 12, body: '{"temp":72}', credentialUnresolved: false });
      const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'weather today' });
      expect(toolInvoker.invoke).toHaveBeenCalledWith(definition, { q: 'weather today' });
      expect(result.nodes[0]).toMatchObject({ node_id: 'tool-1', status: 'complete', simulated: false });
    });

    it('reports failed when the real tool call itself fails', async () => {
      const { useCase, validator, toolDefs, toolInvoker } = make();
      validator.runSchemaGate.mockReturnValue(gateResult(reasoning([toolNode()])));
      toolDefs.findByApiRef.mockResolvedValue({ id: 't1', tenantId: 'tenant-1', apiRef: 'weather-api', name: 'Weather' } as never);
      toolInvoker.invoke.mockResolvedValue({ ok: false, durationMs: 5, credentialUnresolved: false, errorCode: 'TOOL_HTTP_ERROR' });
      const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
      expect(result.nodes[0]).toMatchObject({ node_id: 'tool-1', status: 'failed' });
    });

    it('resolves a literal (non-$-prefixed) argument_mapping value as-is', async () => {
      const { useCase, validator, toolDefs, toolInvoker } = make();
      validator.runSchemaGate.mockReturnValue(gateResult(reasoning([toolNode({ argument_mapping: { unit: 'celsius' } })])));
      toolDefs.findByApiRef.mockResolvedValue({ id: 't1', tenantId: 'tenant-1', apiRef: 'weather-api', name: 'Weather' } as never);
      toolInvoker.invoke.mockResolvedValue({ ok: true, durationMs: 1, credentialUnresolved: false });
      await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
      expect(toolInvoker.invoke).toHaveBeenCalledWith(expect.anything(), { unit: 'celsius' });
    });

    it('resolves a $state.<key> argument_mapping value from turn state, defaulting to null when absent', async () => {
      const { useCase, validator, toolDefs, toolInvoker } = make();
      validator.runSchemaGate.mockReturnValue(gateResult(reasoning([toolNode({ argument_mapping: { foo: '$state.does_not_exist' } })])));
      toolDefs.findByApiRef.mockResolvedValue({ id: 't1', tenantId: 'tenant-1', apiRef: 'weather-api', name: 'Weather' } as never);
      toolInvoker.invoke.mockResolvedValue({ ok: true, durationMs: 1, credentialUnresolved: false });
      await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
      expect(toolInvoker.invoke).toHaveBeenCalledWith(expect.anything(), { foo: null });
    });

    it('an unknown api_ref resolves the on_error goto edge, not next_node_id (Phase 10 fix, Phase 9 finding #2)', async () => {
      const { useCase, validator, toolDefs } = make();
      validator.runSchemaGate.mockReturnValue(
        gateResult(
          reasoning([
            toolNode({ api_ref: 'ghost-api', next_node_id: 'wrong-target', on_error: { action: 'goto', target_node_id: 'end-1' } }),
            endNode(),
          ]),
        ),
      );
      toolDefs.findByApiRef.mockResolvedValue(null);
      const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
      expect(result.nodes.map((n) => n.node_id)).toEqual(['tool-1', 'end-1']);
    });

    it('a real tool call failure resolves the on_error goto edge, not next_node_id', async () => {
      const { useCase, validator, toolDefs, toolInvoker } = make();
      validator.runSchemaGate.mockReturnValue(
        gateResult(
          reasoning([
            toolNode({ next_node_id: 'wrong-target', on_error: { action: 'goto', target_node_id: 'end-1' } }),
            endNode(),
          ]),
        ),
      );
      toolDefs.findByApiRef.mockResolvedValue({ id: 't1', tenantId: 'tenant-1', apiRef: 'weather-api', name: 'Weather' } as never);
      toolInvoker.invoke.mockResolvedValue({ ok: false, durationMs: 5, credentialUnresolved: false, errorCode: 'TOOL_HTTP_ERROR' });
      const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
      expect(result.nodes.map((n) => n.node_id)).toEqual(['tool-1', 'end-1']);
    });

    it('a tool failure with no goto on_error stops the walk instead of proceeding to next_node_id', async () => {
      const { useCase, validator, toolDefs } = make();
      validator.runSchemaGate.mockReturnValue(gateResult(reasoning([toolNode({ api_ref: 'ghost-api', next_node_id: 'end-1' }), endNode()])));
      toolDefs.findByApiRef.mockResolvedValue(null);
      const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].node_id).toBe('tool-1');
    });
  });

  it('a Retrieve node is a logged no-op stub that always completes', async () => {
    const { useCase, validator } = make();
    validator.runSchemaGate.mockReturnValue(gateResult(reasoning([retrieveNode()])));
    const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
    expect(result.nodes[0]).toMatchObject({ node_id: 'retrieve-1', node_type: 'retrieve', status: 'complete', simulated: true });
  });

  describe('Parallel node (Phase 11, BL-042)', () => {
    it('walks every branch sequentially, flattening each branch\'s node results, then the Parallel node\'s own join summary, then next_node_id', async () => {
      const { useCase, validator, toolDefs, toolInvoker } = make();
      validator.runSchemaGate.mockReturnValue(
        gateResult(
          reasoning([
            parallelNode({
              branches: [
                { id: 'a', entry_node_id: 'tool-a' },
                { id: 'b', entry_node_id: 'tool-b' },
              ],
              next_node_id: 'end-1',
            }),
            toolNode({ id: 'tool-a', api_ref: 'order-api', next_node_id: null }),
            toolNode({ id: 'tool-b', api_ref: 'shipping-api', next_node_id: null }),
            endNode(),
          ]),
        ),
      );
      toolDefs.findByApiRef.mockResolvedValue({ id: 't1', tenantId: 'tenant-1', apiRef: 'x', name: 'X' } as never);
      toolInvoker.invoke.mockResolvedValue({ ok: true, durationMs: 1, credentialUnresolved: false });
      const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
      // The Parallel node's own summary is only known once every branch has
      // been walked (it needs the join outcome), so it appears after its
      // branches' flattened results, not before — same ordering the real
      // Python interpreter's node trace produces for the identical reason
      // (`ParallelNodeExecutor.execute` only returns its own `NodeResult`
      // after every branch's `walk_chain` call has already recorded its own).
      expect(result.nodes.map((n) => n.node_id)).toEqual(['tool-a', 'tool-b', 'parallel-1', 'end-1']);
      expect(result.nodes[2]).toMatchObject({ node_type: 'parallel', status: 'complete', simulated: true });
    });

    it('join_policy all + on_branch_error fail: a failed branch fails the node and resolves on_error', async () => {
      const { useCase, validator, toolDefs } = make();
      validator.runSchemaGate.mockReturnValue(
        gateResult(
          reasoning([
            parallelNode({
              branches: [{ id: 'a', entry_node_id: 'tool-a' }],
              on_branch_error: 'fail',
              on_error: { action: 'goto', target_node_id: 'end-1' },
              next_node_id: 'wrong-target',
            }),
            toolNode({ id: 'tool-a', api_ref: 'ghost-api', next_node_id: null }),
            endNode(),
          ]),
        ),
      );
      toolDefs.findByApiRef.mockResolvedValue(null); // unknown api_ref -> the branch's tool node fails
      const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
      expect(result.nodes.map((n) => n.node_id)).toEqual(['tool-a', 'parallel-1', 'end-1']);
      expect(result.nodes[1]).toMatchObject({ node_type: 'parallel', status: 'failed' });
    });

    it('join_policy all + on_branch_error continue_partial: a failed branch still proceeds to next_node_id', async () => {
      const { useCase, validator, toolDefs } = make();
      validator.runSchemaGate.mockReturnValue(
        gateResult(
          reasoning([
            parallelNode({ branches: [{ id: 'a', entry_node_id: 'tool-a' }], on_branch_error: 'continue_partial', next_node_id: 'end-1' }),
            toolNode({ id: 'tool-a', api_ref: 'ghost-api', next_node_id: null }),
            endNode(),
          ]),
        ),
      );
      toolDefs.findByApiRef.mockResolvedValue(null);
      const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
      expect(result.nodes.map((n) => n.node_id)).toEqual(['tool-a', 'parallel-1', 'end-1']);
      expect(result.nodes[1]).toMatchObject({ node_type: 'parallel', status: 'complete' });
    });
  });

  describe('Loop node (Phase 11, BL-043)', () => {
    it('runs the body once per iteration until the condition holds, then continues to next_node_id', async () => {
      const { useCase, validator } = make();
      validator.runSchemaGate.mockReturnValue(
        gateResult(
          reasoning([
            loopNode({ body_entry_node_id: 'llm-1', condition: 'utterance == "hi"', max_iterations: 5, next_node_id: 'end-1' }),
            llmNode({ next_node_id: null }),
            endNode(),
          ]),
        ),
      );
      const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
      // Condition holds after exactly one pass (utterance is literally "hi").
      // Same ordering rationale as Parallel above: the Loop node's own
      // summary is only known once the body/condition loop has finished.
      expect(result.nodes.map((n) => n.node_id)).toEqual(['llm-1', 'loop-1', 'end-1']);
      expect(result.nodes[1]).toMatchObject({ node_type: 'loop', status: 'complete', summary: expect.stringContaining('condition held') });
    });

    it('a condition that never holds stops at the simulator cap, not the real max_iterations, when max_iterations is larger', async () => {
      const { useCase, validator } = make();
      validator.runSchemaGate.mockReturnValue(
        gateResult(
          reasoning([
            loopNode({ body_entry_node_id: 'llm-1', condition: 'utterance == "never"', max_iterations: 1000, next_node_id: 'end-1' }),
            llmNode({ next_node_id: null }),
            endNode(),
          ]),
        ),
      );
      const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
      // 10 iterations * 1 llm node each = 10 llm-1 results, then the loop
      // node's own summary, then end-1.
      const llmResults = result.nodes.filter((n) => n.node_id === 'llm-1');
      expect(llmResults).toHaveLength(10);
      expect(result.nodes[10]).toMatchObject({ node_type: 'loop', status: 'complete', summary: expect.stringContaining("simulator's cap") });
      expect(result.nodes[result.nodes.length - 1].node_id).toBe('end-1');
    });

    it('a malformed condition fails the node and resolves on_error, not next_node_id', async () => {
      const { useCase, validator } = make();
      validator.runSchemaGate.mockReturnValue(
        gateResult(
          reasoning([
            loopNode({
              body_entry_node_id: 'llm-1',
              condition: 'utterance > "x"',
              on_error: { action: 'goto', target_node_id: 'end-1' },
              next_node_id: 'wrong-target',
            }),
            llmNode({ next_node_id: null }),
            endNode(),
          ]),
        ),
      );
      const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
      // The body runs once (llm-1) before the malformed condition is
      // evaluated and fails the loop node itself.
      expect(result.nodes.map((n) => n.node_id)).toEqual(['llm-1', 'loop-1', 'end-1']);
      expect(result.nodes[1]).toMatchObject({ node_type: 'loop', status: 'failed' });
    });
  });

  it('stops after MAX_STEPS on a pathological ref cycle rather than looping forever', async () => {
    const { useCase, validator } = make();
    // Two llm nodes pointing at each other — Gate A structural checks would
    // normally have flagged this at save time, but the simulator itself must
    // still terminate defensively for an already-saved-then-corrupted or
    // adversarial draft config.
    validator.runSchemaGate.mockReturnValue(
      gateResult(reasoning([llmNode({ id: 'llm-1', next_node_id: 'llm-2' }), llmNode({ id: 'llm-2', next_node_id: 'llm-1' })])),
    );
    const result = await useCase.execute(actor, 'tenant-1', { config: {}, utterance: 'hi' });
    expect(result.nodes.length).toBeLessThanOrEqual(50);
    expect(result.ok).toBe(true);
  });
});
