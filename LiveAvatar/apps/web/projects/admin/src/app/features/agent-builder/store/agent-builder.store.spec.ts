import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { DeploymentConfigApiService, ProvidersApiService, TenantsApiService } from '@liveavatar/web-shared';
import { AgentBuilderStore } from './agent-builder.store';

function config(overrides: Record<string, unknown> = {}) {
  return {
    id: 'config-1',
    tenant_id: 't-1',
    yaml_text: 'version: 1\ntransport:\n  provider: livekit\n',
    status: 'draft' as const,
    providers: { transport: null, stt: null, llm: null, llm_fallback: null, tts: null, avatar: null },
    updated_at: '2026-01-01T00:00:00.000Z',
    updated_by: null,
    published_at: null,
    ...overrides,
  };
}

describe('AgentBuilderStore', () => {
  let deploymentConfigApi: { get: jest.Mock; validate: jest.Mock; save: jest.Mock };
  let providersApi: { listDefinitions: jest.Mock; listCredentials: jest.Mock };
  let tenantsApi: { get: jest.Mock };
  let store: InstanceType<typeof AgentBuilderStore>;

  beforeEach(() => {
    deploymentConfigApi = {
      get: jest.fn(() => of(config())),
      validate: jest.fn(() => of({ valid: false, errors: [], resolved: {}, redacted_yaml: 'version: 1\n' })),
      save: jest.fn(),
    };
    providersApi = {
      listDefinitions: jest.fn(() => of({ items: [] })),
      listCredentials: jest.fn(() => of({ items: [] })),
    };
    tenantsApi = { get: jest.fn(() => of({ id: 't-1', name: 'Acme', slug: 'acme' })) };

    TestBed.configureTestingModule({
      providers: [
        { provide: DeploymentConfigApiService, useValue: deploymentConfigApi },
        { provide: ProvidersApiService, useValue: providersApi },
        { provide: TenantsApiService, useValue: tenantsApi },
      ],
    });
    store = TestBed.inject(AgentBuilderStore);
  });

  it('loads the tenant, hydrates the draft from stored YAML, and runs an initial validate', () => {
    store.load('t-1');
    expect(store.status()).toBe('ready');
    expect(store.tenantName()).toBe('Acme');
    expect(store.draft().transport?.provider).toBe('livekit');
    expect(store.ifMatch()).toBe('2026-01-01T00:00:00.000Z');
    expect(deploymentConfigApi.validate).toHaveBeenCalledWith('t-1', expect.objectContaining({ config: expect.any(Object) }));
  });

  it('falls back to an empty draft when yaml_text is empty (new tenant)', () => {
    deploymentConfigApi.get.mockReturnValue(of(config({ yaml_text: '' })));
    store.load('t-1');
    expect(store.draft().stt).toBeUndefined();
  });

  it('sets status: error on a load failure', () => {
    deploymentConfigApi.get.mockReturnValue(throwError(() => ({ code: 'TENANT_NOT_FOUND', message: 'x', status: 404, details: {} })));
    store.load('t-1');
    expect(store.status()).toBe('error');
    expect(store.loadError()?.code).toBe('TENANT_NOT_FOUND');
  });

  it('marks dirty and debounces validate on patchDraft', fakeAsync(() => {
    store.load('t-1');
    deploymentConfigApi.validate.mockClear();

    store.patchDraft({ stt: { provider: 'deepgram' } });
    expect(store.dirty()).toBe(true);
    expect(deploymentConfigApi.validate).not.toHaveBeenCalled();

    tick(400);
    expect(deploymentConfigApi.validate).toHaveBeenCalledTimes(1);
  }));

  it('re-validates on every later, independent edit burst in the same tab session (regression: no distinctUntilChanged starvation on a void Subject)', fakeAsync(() => {
    store.load('t-1');
    deploymentConfigApi.validate.mockClear();

    store.patchDraft({ stt: { provider: 'deepgram' } });
    tick(400);
    expect(deploymentConfigApi.validate).toHaveBeenCalledTimes(1);

    // A second, later edit burst — on the pre-fix pipe
    // (`distinctUntilChanged()` over a `Subject<void>`), this emission was
    // silently swallowed as a "duplicate" of the first (both carry
    // `undefined`), so `validate` was never called again for the rest of
    // this store instance's lifetime.
    store.patchDraft({ stt: { provider: 'faster-whisper' } });
    tick(400);
    expect(deploymentConfigApi.validate).toHaveBeenCalledTimes(2);
  }));

  it('canPublish reflects the last validate result', () => {
    deploymentConfigApi.validate.mockReturnValue(of({ valid: true, errors: [], resolved: {}, redacted_yaml: '' }));
    store.load('t-1');
    expect(store.canPublish()).toBe(true);
  });

  it('saveDraft persists and calls onSuccess only after the server confirms', () => {
    store.load('t-1');
    deploymentConfigApi.save.mockReturnValue(of(config({ status: 'draft', updated_at: '2026-01-02T00:00:00.000Z' })));
    const onSuccess = jest.fn();
    store.saveDraft(onSuccess);
    expect(deploymentConfigApi.save).toHaveBeenCalledWith('t-1', { config: store.draft(), save_as: 'draft' }, '2026-01-01T00:00:00.000Z');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(store.dirty()).toBe(false);
    expect(store.ifMatch()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('sets conflict on a 409 CONFIG_CONFLICT save error, without calling onSuccess', () => {
    store.load('t-1');
    deploymentConfigApi.save.mockReturnValue(
      throwError(() => ({ code: 'CONFIG_CONFLICT', message: 'x', status: 409, details: {} })),
    );
    const onSuccess = jest.fn();
    store.publish(onSuccess);
    expect(store.conflict()).toBe(true);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('sets saveAlert on a non-conflict save error', () => {
    store.load('t-1');
    deploymentConfigApi.save.mockReturnValue(
      throwError(() => ({ code: 'CONFIG_INCOMPLETE', message: 'Select a provider.', status: 422, details: {} })),
    );
    store.publish();
    expect(store.saveAlert()).toBe('Select a provider.');
  });

  it('reloadAfterConflict re-fetches the config for the current tenant', () => {
    store.load('t-1');
    deploymentConfigApi.get.mockClear();
    store.reloadAfterConflict();
    expect(deploymentConfigApi.get).toHaveBeenCalledWith('t-1');
  });

  it('dynamics() falls back to the schema defaults when the config has never had this block set (Phase 16, BL-062)', () => {
    store.load('t-1');
    expect(store.dynamics()).toEqual({
      barge_in: { enabled: true, sensitivity: 'medium' },
      endpointing_silence_ms: 700,
      verbosity: 'balanced',
      no_input: { timeout_ms: 8000, max_reprompts: 2 },
      call_limits: { max_turn_tokens: 200, max_turn_seconds: 20 },
    });
  });

  it('dynamics() reflects a stored dynamics block once present', () => {
    deploymentConfigApi.get.mockReturnValue(
      of(
        config({
          yaml_text:
            'version: 1\ndynamics:\n  barge_in: { enabled: false, sensitivity: low }\n  endpointing_silence_ms: 500\n  verbosity: concise\n  no_input: { timeout_ms: 5000, max_reprompts: 1 }\n  call_limits: { max_turn_tokens: 100, max_turn_seconds: 10 }\n',
        }),
      ),
    );
    store.load('t-1');
    expect(store.dynamics().barge_in).toEqual({ enabled: false, sensitivity: 'low' });
    expect(store.dynamics().endpointing_silence_ms).toBe(500);
  });

  it('errorsByField groups validate errors by their JSON-Pointer field path (dynamics has no layer)', () => {
    deploymentConfigApi.validate.mockReturnValue(
      of({
        valid: false,
        errors: [{ code: 'CONFIG_YAML_PARSE', field: '/dynamics/endpointing_silence_ms', message: 'Out of range.' }],
        resolved: {},
        redacted_yaml: '',
      }),
    );
    store.load('t-1');
    expect(store.errorsByField().get('/dynamics/endpointing_silence_ms')).toHaveLength(1);
  });

  it('hasUnpublishedChanges is true only when published and dirty', () => {
    deploymentConfigApi.get.mockReturnValue(of(config({ status: 'published' })));
    store.load('t-1');
    expect(store.hasUnpublishedChanges()).toBe(false);
    store.patchDraft({ stt: { provider: 'deepgram' } });
    expect(store.hasUnpublishedChanges()).toBe(true);
  });
});
