import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { SkillsApiService } from '@liveavatar/web-shared';
import { SkillsLibraryStore } from './skills-library.store';

function skillVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'version-1',
    version_number: 1,
    status: 'draft' as const,
    name: 'refunds',
    description: 'Handle refunds',
    instructions: '',
    trigger_mode: 'model' as const,
    tools: [],
    knowledge_filters: { source_refs: [] },
    budget_ms: 1500,
    environments: ['dev', 'staging', 'production'],
    published_at: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function skill(overrides: Record<string, unknown> = {}) {
  return {
    id: 'skill-1',
    tenant_id: 't-1',
    name: 'refunds',
    slug: 'refunds',
    draft_version: skillVersion(),
    published_version: null,
    used_by_agent_count: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('SkillsLibraryStore', () => {
  let api: { list: jest.Mock; create: jest.Mock; delete: jest.Mock };
  let store: InstanceType<typeof SkillsLibraryStore>;

  beforeEach(() => {
    api = {
      list: jest.fn(() => of({ items: [skill()] })),
      create: jest.fn(),
      delete: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: SkillsApiService, useValue: api }],
    });
    store = TestBed.inject(SkillsLibraryStore);
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

  it('creates a skill, reloads the list, and calls onSuccess', () => {
    store.load('t-1');
    api.create.mockReturnValue(of(skill({ id: 'skill-2' })));
    api.list.mockReturnValue(of({ items: [skill(), skill({ id: 'skill-2' })] }));
    const onSuccess = jest.fn();

    store.create({ name: 'New skill' }, onSuccess);

    expect(api.create).toHaveBeenCalledWith('t-1', { name: 'New skill' });
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'skill-2' }));
    expect(store.items()).toHaveLength(2);
    expect(store.mutating()).toBe(false);
  });

  it('calls onError and never onSuccess when create fails', () => {
    store.load('t-1');
    api.create.mockReturnValue(throwError(() => ({ code: 'SKILL_NAME_REQUIRED', message: 'x', status: 400, details: {} })));
    const onSuccess = jest.fn();
    const onError = jest.fn();

    store.create({ name: '' }, onSuccess, onError);

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'SKILL_NAME_REQUIRED' }));
    expect(store.mutating()).toBe(false);
  });

  it('deletes a skill and reloads', () => {
    store.load('t-1');
    api.delete.mockReturnValue(of(undefined));
    api.list.mockReturnValue(of({ items: [] }));
    const onSuccess = jest.fn();

    store.remove('skill-1', onSuccess);

    expect(api.delete).toHaveBeenCalledWith('t-1', 'skill-1');
    expect(onSuccess).toHaveBeenCalled();
    expect(store.items()).toHaveLength(0);
  });

  it('calls onError when delete fails', () => {
    store.load('t-1');
    api.delete.mockReturnValue(throwError(() => ({ code: 'SKILL_NOT_FOUND', message: 'x', status: 404, details: {} })));
    const onError = jest.fn();

    store.remove('skill-1', undefined, onError);

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'SKILL_NOT_FOUND' }));
    expect(store.mutating()).toBe(false);
  });

  it('is a no-op when load has not set a tenantId yet', () => {
    store.create({ name: 'x' });
    store.remove('skill-1');
    expect(api.create).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });
});
