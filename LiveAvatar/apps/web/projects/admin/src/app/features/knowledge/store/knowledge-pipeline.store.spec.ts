import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { DeploymentConfigApiService } from '@liveavatar/web-shared';
import { KnowledgePipelineStore } from './knowledge-pipeline.store';

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

const pipelineYaml = `version: 1
knowledge:
  pipeline:
    rewrite: { enabled: true, context_turns: 3, budget_ms: 150 }
    hybrid_search: { vector_weight: 0.6, keyword_weight: 0.4, candidates: 20, budget_ms: 100 }
    metadata_filter: { enabled: false, budget_ms: 20 }
    rerank: { enabled: false }
    threshold: { min_score: 0.5, budget_ms: 10 }
    inject: { token_cap: 1200, citation_format: numbered, budget_ms: 30 }
reasoning:
  entry_node_id: retrieve-1
  background_entry_node_ids: []
  turn_budget_ms: 3000
  graph:
    - id: retrieve-1
      type: retrieve
      name: Search
      lane: foreground
      on_error: { action: degrade }
      on_deadline: { action: degrade }
      source_refs: []
      top_k: 5
      budget_ms: 400
      next_node_id: null
`;

const pipelineYamlNoRetrieveNode = `version: 1
knowledge:
  pipeline:
    rewrite: { enabled: true, context_turns: 3, budget_ms: 150 }
    hybrid_search: { vector_weight: 0.6, keyword_weight: 0.4, candidates: 20, budget_ms: 100 }
    metadata_filter: { enabled: false, budget_ms: 20 }
    rerank: { enabled: false }
    threshold: { min_score: 0.5, budget_ms: 10 }
    inject: { token_cap: 1200, citation_format: numbered, budget_ms: 30 }
`;

describe('KnowledgePipelineStore', () => {
  let deploymentConfigApi: { get: jest.Mock; validate: jest.Mock; save: jest.Mock };
  let store: InstanceType<typeof KnowledgePipelineStore>;

  beforeEach(() => {
    deploymentConfigApi = {
      get: jest.fn(() => of(config({ yaml_text: pipelineYaml }))),
      validate: jest.fn(() => of({ valid: true, errors: [], resolved: {}, redacted_yaml: '', critical_path: null })),
      save: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: DeploymentConfigApiService, useValue: deploymentConfigApi }],
    });
    store = TestBed.inject(KnowledgePipelineStore);
  });

  it('loads and hydrates pipeline() from the parsed draft YAML', () => {
    store.load('t-1');
    expect(store.status()).toBe('ready');
    expect(store.pipeline()).toEqual(
      expect.objectContaining({
        rewrite: { enabled: true, context_turns: 3, budget_ms: 150 },
        hybrid_search: { vector_weight: 0.6, keyword_weight: 0.4, candidates: 20, budget_ms: 100 },
      }),
    );
  });

  it('sets status: error on a load failure', () => {
    deploymentConfigApi.get.mockReturnValue(throwError(() => ({ code: 'TENANT_NOT_FOUND', message: 'x', status: 404, details: {} })));
    store.load('t-1');
    expect(store.status()).toBe('error');
  });

  it('resolves retrieveNodeBudgetMs from the first retrieve-type graph node', () => {
    store.load('t-1');
    expect(store.retrieveNodeBudgetMs()).toBe(400);
  });

  it('retrieveNodeBudgetMs is null when no retrieve node exists yet', () => {
    deploymentConfigApi.get.mockReturnValue(of(config({ yaml_text: pipelineYamlNoRetrieveNode })));
    store.load('t-1');
    expect(store.retrieveNodeBudgetMs()).toBeNull();
  });

  it('updateStage replaces one stage, marks dirty, and schedules a debounced validate', fakeAsync(() => {
    store.load('t-1');
    deploymentConfigApi.validate.mockClear();

    store.updateStage('threshold', { min_score: 0.75, budget_ms: 25 });

    expect(store.pipeline()?.threshold).toEqual({ min_score: 0.75, budget_ms: 25 });
    expect(store.dirty()).toBe(true);
    expect(deploymentConfigApi.validate).not.toHaveBeenCalled();

    tick(400);
    expect(deploymentConfigApi.validate).toHaveBeenCalledTimes(1);
  }));

  it('re-validates on every later, independent edit burst in the same tab session (regression: no distinctUntilChanged starvation on a void Subject)', fakeAsync(() => {
    store.load('t-1');
    deploymentConfigApi.validate.mockClear();

    store.updateStage('threshold', { min_score: 0.75, budget_ms: 25 });
    tick(400);
    expect(deploymentConfigApi.validate).toHaveBeenCalledTimes(1);

    // A second, later edit burst — on the pre-fix pipe
    // (`distinctUntilChanged()` over a `Subject<void>`), this emission was
    // silently swallowed as a "duplicate" of the first (both carry
    // `undefined`), so `validate` was never called again for the rest of
    // this store instance's lifetime.
    store.updateStage('threshold', { min_score: 0.6, budget_ms: 30 });
    tick(400);
    expect(deploymentConfigApi.validate).toHaveBeenCalledTimes(2);
  }));

  it('updateStage does nothing when the pipeline has not loaded yet', () => {
    store.updateStage('threshold', { min_score: 0.75, budget_ms: 25 });
    expect(store.pipeline()).toBeNull();
  });

  it('budgetExceededErrors surfaces CONFIG_RETRIEVAL_BUDGET_EXCEEDED errors keyed by any retrieve node id', () => {
    deploymentConfigApi.validate.mockReturnValue(
      of({
        valid: false,
        errors: [
          { code: 'CONFIG_RETRIEVAL_BUDGET_EXCEEDED', layer: 'reasoning.graph', field: 'retrieve-1', message: 'Pipeline exceeds budget.' },
        ],
        resolved: {},
        redacted_yaml: '',
        critical_path: null,
      }),
    );
    store.load('t-1');
    expect(store.budgetExceededErrors()).toHaveLength(1);
    expect(store.budgetExceededErrors()[0].message).toBe('Pipeline exceeds budget.');
    expect(store.staleSourceErrors()).toHaveLength(0);
  });

  it('staleSourceErrors surfaces KNOWLEDGE_SOURCE_STALE errors', () => {
    deploymentConfigApi.validate.mockReturnValue(
      of({
        valid: true,
        errors: [
          {
            code: 'KNOWLEDGE_SOURCE_STALE',
            layer: 'reasoning.graph',
            field: 'retrieve-1',
            message: 'This knowledge source has not been re-indexed since its configuration changed.',
            severity: 'warning',
          },
        ],
        resolved: {},
        redacted_yaml: '',
        critical_path: null,
      }),
    );
    store.load('t-1');
    expect(store.staleSourceErrors()).toHaveLength(1);
    expect(store.budgetExceededErrors()).toHaveLength(0);
  });

  it('exposes neither error signal when validation carries no matching codes', () => {
    store.load('t-1');
    expect(store.budgetExceededErrors()).toHaveLength(0);
    expect(store.staleSourceErrors()).toHaveLength(0);
  });

  it('saveDraft persists the draft, keyed by If-Match, and calls onSuccess', () => {
    store.load('t-1');
    deploymentConfigApi.save.mockReturnValue(of(config({ yaml_text: pipelineYaml, status: 'draft' })));
    const onSuccess = jest.fn();

    store.saveDraft(onSuccess);

    expect(deploymentConfigApi.save).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({ save_as: 'draft' }),
      '2026-01-01T00:00:00.000Z',
    );
    expect(onSuccess).toHaveBeenCalled();
    expect(store.dirty()).toBe(false);
  });

  it('publish sets conflict on CONFIG_CONFLICT rather than a generic alert', () => {
    store.load('t-1');
    deploymentConfigApi.save.mockReturnValue(throwError(() => ({ code: 'CONFIG_CONFLICT', message: 'x', status: 409, details: {} })));

    store.publish();

    expect(store.conflict()).toBe(true);
    expect(store.saveAlert()).toBeNull();
  });
});
