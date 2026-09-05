import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { DeploymentConfigApiService, ToolsApiService } from '@liveavatar/web-shared';
import { ToolsStore } from './tools.store';

function config(overrides: Record<string, unknown> = {}) {
  return {
    id: 'config-1',
    tenant_id: 't-1',
    yaml_text: 'version: 1\nagent:\n  tools: []\n',
    status: 'draft' as const,
    providers: { transport: null, stt: null, llm: null, llm_fallback: null, tts: null, avatar: null },
    updated_at: '2026-01-01T00:00:00.000Z',
    updated_by: null,
    published_at: null,
    ...overrides,
  };
}

function tool(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tool-1',
    tenant_id: 't-1',
    api_ref: 'lookup_order',
    name: 'Lookup order',
    description: null,
    method: 'GET',
    url: 'https://api.example.com/orders',
    credential_ref: null,
    requires_credential: false,
    args_schema: {},
    enabled: true,
    consequential: false,
    autonomous_use_ack_text: null,
    lane: 'foreground' as const,
    per_session_cap: null,
    per_turn_cap: null,
    timeout_ms: 10000,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ToolsStore', () => {
  let api: {
    list: jest.Mock;
    get: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    testInvoke: jest.Mock;
  };
  let configApi: { get: jest.Mock; save: jest.Mock };
  let store: InstanceType<typeof ToolsStore>;

  beforeEach(() => {
    api = {
      list: jest.fn(() => of({ items: [tool()] })),
      get: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      testInvoke: jest.fn(),
    };
    configApi = {
      get: jest.fn(() => of(config())),
      save: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ToolsApiService, useValue: api },
        { provide: DeploymentConfigApiService, useValue: configApi },
      ],
    });
    store = TestBed.inject(ToolsStore);
  });

  it('loads the registry for a tenant', () => {
    store.load('t-1');
    expect(store.status()).toBe('ready');
    expect(store.items()).toHaveLength(1);
    expect(api.list).toHaveBeenCalledWith('t-1');
  });

  it('sets status: error on a load failure', () => {
    api.list.mockReturnValue(throwError(() => ({ code: 'TENANT_NOT_FOUND', message: 'x', status: 404, details: {} })));
    store.load('t-1');
    expect(store.status()).toBe('error');
    expect(store.loadError()?.code).toBe('TENANT_NOT_FOUND');
  });

  it('creates a tool, reloads the list, and calls onSuccess', () => {
    store.load('t-1');
    api.create.mockReturnValue(of(tool({ id: 'tool-2' })));
    api.list.mockReturnValue(of({ items: [tool(), tool({ id: 'tool-2' })] }));
    const onSuccess = jest.fn();

    store.create({ name: 'New tool', method: 'GET', url: 'https://api.example.com/x' }, onSuccess);

    expect(api.create).toHaveBeenCalledWith('t-1', { name: 'New tool', method: 'GET', url: 'https://api.example.com/x' });
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'tool-2' }));
    expect(store.items()).toHaveLength(2);
    expect(store.mutating()).toBe(false);
  });

  it('calls onError and never onSuccess when create fails', () => {
    store.load('t-1');
    api.create.mockReturnValue(throwError(() => ({ code: 'TOOL_NAME_REQUIRED', message: 'x', status: 400, details: {} })));
    const onSuccess = jest.fn();
    const onError = jest.fn();

    store.create({ name: '', method: 'GET', url: 'https://api.example.com/x' }, onSuccess, onError);

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOOL_NAME_REQUIRED' }));
    expect(store.mutating()).toBe(false);
  });

  it('updates a tool with the given If-Match', () => {
    store.load('t-1');
    api.update.mockReturnValue(of(tool({ name: 'Renamed' })));
    const onSuccess = jest.fn();

    store.update('tool-1', { name: 'Renamed' }, '2026-01-01T00:00:00.000Z', onSuccess);

    expect(api.update).toHaveBeenCalledWith('t-1', 'tool-1', { name: 'Renamed' }, '2026-01-01T00:00:00.000Z');
    expect(onSuccess).toHaveBeenCalled();
  });

  it('deletes a tool and reloads', () => {
    store.load('t-1');
    api.delete.mockReturnValue(of(undefined));
    api.list.mockReturnValue(of({ items: [] }));
    const onSuccess = jest.fn();

    store.remove('tool-1', onSuccess);

    expect(api.delete).toHaveBeenCalledWith('t-1', 'tool-1');
    expect(onSuccess).toHaveBeenCalled();
    expect(store.items()).toHaveLength(0);
  });

  it('runs a test-invoke and stores the result per tool id', () => {
    store.load('t-1');
    api.testInvoke.mockReturnValue(of({ ok: true, status: 200, duration_ms: 42 }));

    store.testInvoke('tool-1', { order_id: '4821' });

    expect(api.testInvoke).toHaveBeenCalledWith('t-1', 'tool-1', { arguments: { order_id: '4821' } });
    expect(store.testResults()['tool-1']).toEqual({ ok: true, status: 200, duration_ms: 42 });
    expect(store.testingId()).toBeNull();
  });

  it('clears testingId even when the test-invoke call errors', () => {
    store.load('t-1');
    api.testInvoke.mockReturnValue(throwError(() => ({ code: 'TOOL_NOT_FOUND', message: 'x', status: 404, details: {} })));

    store.testInvoke('tool-1', {});

    expect(store.testingId()).toBeNull();
  });

  it('loads the current draft alongside the registry, exposing attachedRefs', () => {
    configApi.get.mockReturnValue(
      of(config({ yaml_text: 'version: 1\nagent:\n  tools:\n    - name: Lookup order\n      api_ref: lookup_order\n      enabled: true\n' })),
    );
    store.load('t-1');
    expect(store.attachedRefs()).toEqual(new Set(['lookup_order']));
  });

  it('attaches a tool by PUTting the whole draft config, preserving unrelated fields', () => {
    configApi.get.mockReturnValue(
      of(config({ yaml_text: 'version: 1\ntransport:\n  provider: livekit\nagent:\n  tools: []\n' })),
    );
    store.load('t-1');
    configApi.save.mockReturnValue(
      of(config({ updated_at: '2026-01-02T00:00:00.000Z', yaml_text: 'version: 1\nagent:\n  tools:\n    - name: Lookup order\n      api_ref: lookup_order\n      enabled: true\n' })),
    );
    const onSuccess = jest.fn();

    store.toggleAttach(tool(), onSuccess);

    expect(configApi.save).toHaveBeenCalledWith(
      't-1',
      {
        config: expect.objectContaining({
          transport: { provider: 'livekit' },
          agent: { tools: [{ name: 'Lookup order', api_ref: 'lookup_order', enabled: true }] },
        }),
        save_as: 'draft',
      },
      '2026-01-01T00:00:00.000Z',
    );
    expect(onSuccess).toHaveBeenCalledWith(true);
    expect(store.draftIfMatch()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('detaches an attached tool by removing it from agent.tools[]', () => {
    configApi.get.mockReturnValue(
      of(config({ yaml_text: 'version: 1\nagent:\n  tools:\n    - name: Lookup order\n      api_ref: lookup_order\n      enabled: true\n' })),
    );
    store.load('t-1');
    configApi.save.mockReturnValue(of(config({ yaml_text: 'version: 1\nagent:\n  tools: []\n' })));
    const onSuccess = jest.fn();

    store.toggleAttach(tool(), onSuccess);

    expect(configApi.save).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({ config: expect.objectContaining({ agent: { tools: [] } }) }),
      '2026-01-01T00:00:00.000Z',
    );
    expect(onSuccess).toHaveBeenCalledWith(false);
  });

  it('calls onError on a failed attach save, leaving draftIfMatch unchanged', () => {
    store.load('t-1');
    configApi.save.mockReturnValue(throwError(() => ({ code: 'CONFIG_CONFLICT', message: 'x', status: 409, details: {} })));
    const onError = jest.fn();

    store.toggleAttach(tool(), undefined, onError);

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONFIG_CONFLICT' }));
    expect(store.draftIfMatch()).toBe('2026-01-01T00:00:00.000Z');
  });
});
