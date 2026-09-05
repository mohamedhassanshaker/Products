import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { KnowledgeSourcesApiService } from '@liveavatar/web-shared';
import { KnowledgeSourcesStore } from './knowledge-sources.store';

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: 'src-1',
    tenant_id: 't-1',
    name: 'Handbook',
    source_type: 'upload' as const,
    original_filename: 'handbook.txt',
    mime_type: 'text/plain',
    file_size_bytes: 2048,
    parser: 'plain_text' as const,
    chunking_strategy: 'fixed' as const,
    chunk_size: 1000,
    chunk_overlap: 100,
    embedding_model: 'text-embedding-3-small',
    embedding_credential_ref: null,
    status: 'ready' as const,
    chunk_count: 12,
    error_message: null,
    is_stale: false,
    config_updated_at: '2026-01-01T00:00:00.000Z',
    last_indexed_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('KnowledgeSourcesStore', () => {
  let api: {
    list: jest.Mock;
    get: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    estimateReindex: jest.Mock;
    triggerReindex: jest.Mock;
  };
  let store: InstanceType<typeof KnowledgeSourcesStore>;

  beforeEach(() => {
    api = {
      list: jest.fn(() => of({ items: [source()] })),
      get: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      estimateReindex: jest.fn(),
      triggerReindex: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: KnowledgeSourcesApiService, useValue: api }],
    });
    store = TestBed.inject(KnowledgeSourcesStore);
  });

  it('loads the registry for a tenant', () => {
    store.load('t-1');
    expect(store.status()).toBe('ready');
    expect(store.items()).toHaveLength(1);
    expect(api.list).toHaveBeenCalledWith('t-1');
  });

  it('sets status: error on a load failure', () => {
    api.list.mockReturnValue(throwError(() => ({ code: 'KNOWLEDGE_SOURCE_FORBIDDEN', message: 'x', status: 403, details: {} })));
    store.load('t-1');
    expect(store.status()).toBe('error');
    expect(store.loadError()?.code).toBe('KNOWLEDGE_SOURCE_FORBIDDEN');
  });

  it('creates a source, reloads the list, and calls onSuccess', () => {
    store.load('t-1');
    const file = new File(['hello'], 'handbook.txt', { type: 'text/plain' });
    api.create.mockReturnValue(of(source({ id: 'src-2' })));
    api.list.mockReturnValue(of({ items: [source(), source({ id: 'src-2' })] }));
    const onSuccess = jest.fn();

    store.create({ name: 'Handbook' }, file, onSuccess);

    expect(api.create).toHaveBeenCalledWith('t-1', { name: 'Handbook' }, file);
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'src-2' }));
    expect(store.items()).toHaveLength(2);
    expect(store.mutating()).toBe(false);
  });

  it('calls onError and never onSuccess when create fails (e.g. invalid chunk overlap)', () => {
    store.load('t-1');
    const file = new File(['hello'], 'handbook.txt', { type: 'text/plain' });
    api.create.mockReturnValue(
      throwError(() => ({ code: 'KNOWLEDGE_SOURCE_CHUNK_OVERLAP_INVALID', message: 'x', status: 400, details: {} })),
    );
    const onSuccess = jest.fn();
    const onError = jest.fn();

    store.create({ name: 'Handbook', chunk_size: 100, chunk_overlap: 500 }, file, onSuccess, onError);

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'KNOWLEDGE_SOURCE_CHUNK_OVERLAP_INVALID' }));
    expect(store.mutating()).toBe(false);
  });

  it('updates a source with the given If-Match', () => {
    store.load('t-1');
    api.update.mockReturnValue(of(source({ name: 'Renamed' })));
    const onSuccess = jest.fn();

    store.update('src-1', { name: 'Renamed' }, '2026-01-01T00:00:00.000Z', onSuccess);

    expect(api.update).toHaveBeenCalledWith('t-1', 'src-1', { name: 'Renamed' }, '2026-01-01T00:00:00.000Z');
    expect(onSuccess).toHaveBeenCalled();
  });

  it('deletes a source and reloads', () => {
    store.load('t-1');
    api.delete.mockReturnValue(of(undefined));
    api.list.mockReturnValue(of({ items: [] }));
    const onSuccess = jest.fn();

    store.remove('src-1', onSuccess);

    expect(api.delete).toHaveBeenCalledWith('t-1', 'src-1');
    expect(onSuccess).toHaveBeenCalled();
    expect(store.items()).toHaveLength(0);
  });

  it('resolves the reindex estimate and clears reindexingId', async () => {
    store.load('t-1');
    const estimate = { chunk_count: 12, estimated_cost_usd: 0.000048, estimated_duration_ms: 600, is_estimate: true as const };
    api.estimateReindex.mockReturnValue(of(estimate));

    const result = await store.estimateReindex('src-1');

    expect(api.estimateReindex).toHaveBeenCalledWith('t-1', 'src-1');
    expect(result).toEqual(estimate);
    expect(store.reindexingId()).toBeNull();
  });

  it('rejects with an AppClientError when the estimate call fails', async () => {
    store.load('t-1');
    api.estimateReindex.mockReturnValue(throwError(() => ({ code: 'KNOWLEDGE_SOURCE_NOT_FOUND', message: 'x', status: 404, details: {} })));

    await expect(store.estimateReindex('src-1')).rejects.toEqual(
      expect.objectContaining({ code: 'KNOWLEDGE_SOURCE_NOT_FOUND' }),
    );
    expect(store.reindexingId()).toBeNull();
  });

  it('triggers a reindex and reloads the list so status reflects pending/processing', async () => {
    store.load('t-1');
    api.triggerReindex.mockReturnValue(of({ enqueued: true }));
    api.list.mockReturnValue(of({ items: [source({ status: 'processing' })] }));

    await store.triggerReindex('src-1');

    expect(api.triggerReindex).toHaveBeenCalledWith('t-1', 'src-1');
    expect(store.items()[0].status).toBe('processing');
    expect(store.reindexingId()).toBeNull();
  });

  it('rejects with an AppClientError when the trigger-reindex call fails', async () => {
    store.load('t-1');
    api.triggerReindex.mockReturnValue(throwError(() => ({ code: 'KNOWLEDGE_INGEST_FAILED', message: 'x', status: 502, details: {} })));

    await expect(store.triggerReindex('src-1')).rejects.toEqual(
      expect.objectContaining({ code: 'KNOWLEDGE_INGEST_FAILED' }),
    );
    expect(store.reindexingId()).toBeNull();
  });
});
