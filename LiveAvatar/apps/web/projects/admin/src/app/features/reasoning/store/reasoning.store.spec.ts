import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import {
  DeploymentConfigApiService,
  HitlApiService,
  ProvidersApiService,
  SkillsApiService,
  TenantsApiService,
  ToolsApiService,
} from '@liveavatar/web-shared';
import { ReasoningStore } from './reasoning.store';

function config(overrides: Record<string, unknown> = {}) {
  return {
    id: 'config-1',
    tenant_id: 't-1',
    yaml_text: 'version: 1\n',
    status: 'draft' as const,
    providers: { transport: null, stt: null, llm: null, llm_fallback: null, tts: null, avatar: null },
    updated_at: '2026-01-01T00:00:00.000Z',
    updated_by: null,
    published_at: null,
    ...overrides,
  };
}

const graphYaml = `version: 1
reasoning:
  entry_node_id: llm-1
  background_entry_node_ids: []
  turn_budget_ms: 3000
  graph:
    - id: llm-1
      type: llm
      name: Answer
      lane: foreground
      on_error: { action: degrade }
      on_deadline: { action: degrade }
      provider: openai
      model: gpt-4o-mini
      retry: { max_attempts: 3, backoff_ms: [200, 400, 800] }
      next_node_id: null
`;

describe('ReasoningStore', () => {
  let deploymentConfigApi: { get: jest.Mock; validate: jest.Mock; save: jest.Mock; testCall: jest.Mock };
  let providersApi: { listDefinitions: jest.Mock; listCredentials: jest.Mock };
  let tenantsApi: { get: jest.Mock; list: jest.Mock };
  let toolsApi: { list: jest.Mock };
  let skillsApi: { list: jest.Mock };
  let hitlApi: { listGates: jest.Mock };
  let store: InstanceType<typeof ReasoningStore>;

  beforeEach(() => {
    deploymentConfigApi = {
      get: jest.fn(() => of(config())),
      validate: jest.fn(() => of({ valid: false, errors: [], resolved: {}, redacted_yaml: '' })),
      save: jest.fn(),
      testCall: jest.fn(),
    };
    providersApi = {
      listDefinitions: jest.fn(() => of({ items: [] })),
      listCredentials: jest.fn(() => of({ items: [] })),
    };
    tenantsApi = { get: jest.fn(() => of({ id: 't-1', name: 'Acme', slug: 'acme' })), list: jest.fn(() => of({ items: [] })) };
    toolsApi = { list: jest.fn(() => of({ items: [] })) };
    skillsApi = { list: jest.fn(() => of({ items: [] })) };
    hitlApi = { listGates: jest.fn(() => of({ items: [] })) };

    TestBed.configureTestingModule({
      providers: [
        { provide: DeploymentConfigApiService, useValue: deploymentConfigApi },
        { provide: ProvidersApiService, useValue: providersApi },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: ToolsApiService, useValue: toolsApi },
        { provide: SkillsApiService, useValue: skillsApi },
        { provide: HitlApiService, useValue: hitlApi },
      ],
    });
    store = TestBed.inject(ReasoningStore);
  });

  it('loads the tenant and hydrates reasoning() as null when config.reasoning is absent (brand-new tenant, R-G1)', () => {
    store.load('t-1');
    expect(store.status()).toBe('ready');
    expect(store.reasoning()).toBeNull();
  });

  it('hydrates reasoning() from the parsed draft YAML when present', () => {
    deploymentConfigApi.get.mockReturnValue(of(config({ yaml_text: graphYaml })));
    store.load('t-1');
    expect(store.reasoning()?.graph).toHaveLength(1);
    expect(store.reasoning()?.entry_node_id).toBe('llm-1');
  });

  it('sets status: error on a load failure', () => {
    deploymentConfigApi.get.mockReturnValue(throwError(() => ({ code: 'TENANT_NOT_FOUND', message: 'x', status: 404, details: {} })));
    store.load('t-1');
    expect(store.status()).toBe('error');
  });

  it('initializeDefaultGraph builds the single-LLM-node default graph (R-G1)', () => {
    store.load('t-1');
    store.initializeDefaultGraph({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(store.reasoning()?.graph).toEqual([
      expect.objectContaining({ id: 'llm-1', type: 'llm', provider: 'openai', model: 'gpt-4o-mini' }),
    ]);
    expect(store.reasoning()?.entry_node_id).toBe('llm-1');
    expect(store.dirty()).toBe(true);
  });

  it('loads the tenant list for the Sub-agent node\'s target picker (Phase 15, BL-058)', () => {
    tenantsApi.list.mockReturnValue(
      of({ items: [{ id: 't-2', name: 'Billing Co', slug: 'billing-co', status: 'active', provider_stack_summary: '', updated_at: '' }] }),
    );
    store.load('t-1');
    expect(tenantsApi.list).toHaveBeenCalledWith({ page: 1, page_size: 100 });
    expect(store.tenants()).toEqual([{ id: 't-2', name: 'Billing Co', slug: 'billing-co', status: 'active', provider_stack_summary: '', updated_at: '' }]);
  });

  it('addNode appends a node with a generated id and returns it', () => {
    deploymentConfigApi.get.mockReturnValue(of(config({ yaml_text: graphYaml })));
    store.load('t-1');
    const id = store.addNode('speak');
    expect(id).toBe('speak-1');
    expect(store.reasoning()?.graph.map((n) => n.id)).toEqual(['llm-1', 'speak-1']);
  });

  it('addNode returns null when there is no graph yet', () => {
    store.load('t-1');
    expect(store.addNode('speak')).toBeNull();
  });

  it('updateNode replaces the matching node by id', () => {
    deploymentConfigApi.get.mockReturnValue(of(config({ yaml_text: graphYaml })));
    store.load('t-1');
    const node = store.reasoning()!.graph[0];
    store.updateNode('llm-1', { ...node, name: 'Renamed' } as typeof node);
    expect(store.reasoning()?.graph[0].name).toBe('Renamed');
  });

  it('removeNode drops the node by id', () => {
    deploymentConfigApi.get.mockReturnValue(of(config({ yaml_text: graphYaml })));
    store.load('t-1');
    store.addNode('end');
    store.removeNode('llm-1');
    expect(store.reasoning()?.graph.map((n) => n.id)).toEqual(['end-1']);
  });

  it('marks dirty and debounces validate on a graph edit', fakeAsync(() => {
    deploymentConfigApi.get.mockReturnValue(of(config({ yaml_text: graphYaml })));
    store.load('t-1');
    deploymentConfigApi.validate.mockClear();

    store.addNode('end');
    expect(store.dirty()).toBe(true);
    expect(deploymentConfigApi.validate).not.toHaveBeenCalled();

    tick(400);
    expect(deploymentConfigApi.validate).toHaveBeenCalledTimes(1);
  }));

  it('re-validates on every later, independent edit burst in the same tab session (regression: no distinctUntilChanged starvation on a void Subject)', fakeAsync(() => {
    deploymentConfigApi.get.mockReturnValue(of(config({ yaml_text: graphYaml })));
    store.load('t-1');
    deploymentConfigApi.validate.mockClear();

    store.addNode('end');
    tick(400);
    expect(deploymentConfigApi.validate).toHaveBeenCalledTimes(1);

    // A second, later edit burst — on the pre-fix pipe
    // (`distinctUntilChanged()` over a `Subject<void>`), this emission was
    // silently swallowed as a "duplicate" of the first (both carry
    // `undefined`), so `validate` was never called again for the rest of
    // this store instance's lifetime.
    store.addNode('end');
    tick(400);
    expect(deploymentConfigApi.validate).toHaveBeenCalledTimes(2);
  }));

  it('groups reasoning.graph errors by node id (field is the node id)', () => {
    deploymentConfigApi.get.mockReturnValue(of(config({ yaml_text: graphYaml })));
    deploymentConfigApi.validate.mockReturnValue(
      of({
        valid: false,
        errors: [{ code: 'CONFIG_GRAPH_REF_UNKNOWN', layer: 'reasoning.graph', field: 'llm-1/next_node_id', message: 'x' }],
        resolved: {},
        redacted_yaml: '',
      }),
    );
    store.load('t-1');
    expect(store.errorsByNode().get('llm-1')).toHaveLength(1);
    expect(store.globalErrors()).toHaveLength(0);
  });

  it('attaches reasoning.llm errors to the first llm node, and treats them as global when no llm node exists', () => {
    deploymentConfigApi.validate.mockReturnValue(
      of({ valid: false, errors: [{ code: 'CONFIG_INCOMPLETE', layer: 'reasoning.llm', message: 'Select a provider.' }], resolved: {}, redacted_yaml: '' }),
    );
    store.load('t-1');
    expect(store.globalErrors()).toHaveLength(1);

    deploymentConfigApi.get.mockReturnValue(of(config({ yaml_text: graphYaml })));
    store.load('t-1');
    expect(store.errorsByNode().get('llm-1')).toHaveLength(1);
    expect(store.globalErrors()).toHaveLength(0);
  });

  it('criticalPath() mirrors the validate response critical_path field (Phase 10, BL-040/041)', () => {
    const criticalPath = {
      critical_path_ms: 900,
      turn_budget_ms: 3000,
      over_budget: false,
      paths: [{ steps: [], total_ms: 900, over_budget: false }],
    };
    deploymentConfigApi.validate.mockReturnValue(
      of({ valid: true, errors: [], resolved: {}, redacted_yaml: '', critical_path: criticalPath }),
    );
    deploymentConfigApi.get.mockReturnValue(of(config({ yaml_text: graphYaml })));
    store.load('t-1');
    expect(store.criticalPath()).toEqual(criticalPath);
  });

  it('criticalPath() is null when the validate response carries no critical_path (e.g. no reasoning block yet)', () => {
    store.load('t-1');
    expect(store.criticalPath()).toBeNull();
  });

  it('agent() hydrates from the parsed draft YAML and defaults to {} when absent (Phase 16 Core instructions)', () => {
    store.load('t-1');
    expect(store.agent()).toEqual({});

    deploymentConfigApi.get.mockReturnValue(
      of(config({ yaml_text: 'version: 1\nagent:\n  runtime: langgraph\n  system_prompt: hi\n' })),
    );
    store.load('t-1');
    expect(store.agent()).toEqual({ runtime: 'langgraph', system_prompt: 'hi' });
  });

  it('setRuntime/setSystemPrompt patch agent and mark dirty', fakeAsync(() => {
    store.load('t-1');
    store.setRuntime('pydantic-ai');
    expect(store.agent().runtime).toBe('pydantic-ai');
    store.setSystemPrompt('You are a helpful agent.');
    expect(store.agent().system_prompt).toBe('You are a helpful agent.');
    expect(store.dirty()).toBe(true);
    tick(400);
  }));

  it('setMemoryEnabled/setMemoryWindowTurns merge into the existing memory object without clobbering the other field', fakeAsync(() => {
    store.load('t-1');
    store.setMemoryEnabled(true);
    expect(store.agent().memory).toEqual({ enabled: true });
    store.setMemoryWindowTurns(24);
    expect(store.agent().memory).toEqual({ enabled: true, window_turns: 24 });
    tick(400);
  }));

  it('errorsByLayer groups validate errors by layer, same shape agent-builder.store.ts uses', () => {
    deploymentConfigApi.validate.mockReturnValue(
      of({
        valid: false,
        errors: [{ code: 'CONFIG_PROMPT_TOO_LARGE', layer: 'agent.system_prompt', message: 'Too large.' }],
        resolved: {},
        redacted_yaml: '',
      }),
    );
    store.load('t-1');
    expect(store.errorsByLayer().get('agent.system_prompt')).toHaveLength(1);
  });

  it('globalErrors excludes agent.system_prompt (shown inline in Core instructions instead)', () => {
    deploymentConfigApi.validate.mockReturnValue(
      of({
        valid: false,
        errors: [{ code: 'CONFIG_PROMPT_TOO_LARGE', layer: 'agent.system_prompt', message: 'Too large.' }],
        resolved: {},
        redacted_yaml: '',
      }),
    );
    store.load('t-1');
    expect(store.globalErrors()).toHaveLength(0);
  });

  it('saveDraft PUTs the whole draft config and calls onSuccess only after the server confirms', () => {
    deploymentConfigApi.get.mockReturnValue(of(config({ yaml_text: graphYaml })));
    store.load('t-1');
    deploymentConfigApi.save.mockReturnValue(of(config({ yaml_text: graphYaml, updated_at: '2026-01-02T00:00:00.000Z' })));
    const onSuccess = jest.fn();

    store.saveDraft(onSuccess);

    expect(deploymentConfigApi.save).toHaveBeenCalledWith('t-1', { config: store.draftConfig(), save_as: 'draft' }, '2026-01-01T00:00:00.000Z');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(store.ifMatch()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('sets conflict on a 409 CONFIG_CONFLICT save error', () => {
    store.load('t-1');
    deploymentConfigApi.save.mockReturnValue(throwError(() => ({ code: 'CONFIG_CONFLICT', message: 'x', status: 409, details: {} })));
    store.publish();
    expect(store.conflict()).toBe(true);
  });

  it('runTestCall calls the shared test-call harness and stores the result', () => {
    store.load('t-1');
    deploymentConfigApi.testCall.mockReturnValue(of({ ok: true, final_text: 'hi there', nodes: [], errors: [] }));

    store.runTestCall('hello');

    expect(deploymentConfigApi.testCall).toHaveBeenCalledWith('t-1', { config: store.draftConfig(), utterance: 'hello' });
    expect(store.testCallResult()?.final_text).toBe('hi there');
    expect(store.testCallRunning()).toBe(false);
  });

  it('runTestCall clears testCallRunning and sets testCallError on failure', () => {
    store.load('t-1');
    deploymentConfigApi.testCall.mockReturnValue(throwError(() => ({ code: 'CONFIG_INVALID', message: 'x', status: 422, details: {} })));

    store.runTestCall('hello');

    expect(store.testCallRunning()).toBe(false);
    expect(store.testCallError()?.code).toBe('CONFIG_INVALID');
  });
});
