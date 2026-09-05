import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HitlApiService, SkillsApiService, ToolsApiService } from '@liveavatar/web-shared';
import { SkillEditorStore } from './skill-editor.store';

function skillVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'version-1',
    version_number: 1,
    status: 'draft' as const,
    name: 'refunds',
    description: 'Handle refunds',
    instructions: 'Step 1...',
    trigger_mode: 'model' as const,
    tools: ['check_eligibility'],
    knowledge_filters: { source_refs: ['returns-policy'] },
    budget_ms: 1340,
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

describe('SkillEditorStore', () => {
  let skillsApi: { get: jest.Mock; updateDraft: jest.Mock; publish: jest.Mock; usage: jest.Mock };
  let toolsApi: { list: jest.Mock };
  let hitlApi: { listGates: jest.Mock };
  let store: InstanceType<typeof SkillEditorStore>;

  beforeEach(() => {
    skillsApi = {
      get: jest.fn(() => of(skill())),
      updateDraft: jest.fn(),
      publish: jest.fn(),
      usage: jest.fn(),
    };
    toolsApi = { list: jest.fn(() => of({ items: [] })) };
    hitlApi = { listGates: jest.fn(() => of({ items: [] })) };

    TestBed.configureTestingModule({
      providers: [
        { provide: SkillsApiService, useValue: skillsApi },
        { provide: ToolsApiService, useValue: toolsApi },
        { provide: HitlApiService, useValue: hitlApi },
      ],
    });
    store = TestBed.inject(SkillEditorStore);
  });

  it('loads a skill and seeds the draft from its draft_version', () => {
    store.load('t-1', 'skill-1');
    expect(store.status()).toBe('ready');
    expect(store.draft()).toEqual({
      name: 'refunds',
      description: 'Handle refunds',
      instructions: 'Step 1...',
      trigger_mode: 'model',
      tools: ['check_eligibility'],
      knowledge_filters: { source_refs: ['returns-policy'] },
      budget_ms: 1340,
      hitl_gate_id: null,
      environments: ['dev', 'staging', 'production'],
    });
    expect(store.dirty()).toBe(false);
  });

  it('seeds the draft from published_version when no draft_version exists', () => {
    skillsApi.get.mockReturnValue(of(skill({ draft_version: null, published_version: skillVersion({ version_number: 3 }) })));
    store.load('t-1', 'skill-1');
    expect(store.draft()?.description).toBe('Handle refunds');
    expect(store.canPublish()).toBe(false);
  });

  it('seeds hitl_gate_id from the version, and loads the tenant gate list for the picker (Phase 14 follow-up, R-S6)', () => {
    skillsApi.get.mockReturnValue(of(skill({ draft_version: skillVersion({ hitl_gate_id: 'gate-1' }) })));
    hitlApi.listGates.mockReturnValue(of({ items: [{ id: 'gate-1' }] }));

    store.load('t-1', 'skill-1');

    expect(store.draft()?.hitl_gate_id).toBe('gate-1');
    expect(hitlApi.listGates).toHaveBeenCalledWith('t-1');
    expect(store.gates()).toEqual([{ id: 'gate-1' }]);
  });

  it('sets status: not_found on a SKILL_NOT_FOUND load error', () => {
    skillsApi.get.mockReturnValue(throwError(() => ({ code: 'SKILL_NOT_FOUND', message: 'x', status: 404, details: {} })));
    store.load('t-1', 'skill-1');
    expect(store.status()).toBe('not_found');
  });

  it('sets status: error on any other load failure', () => {
    skillsApi.get.mockReturnValue(throwError(() => ({ code: 'SKILL_FORBIDDEN', message: 'x', status: 403, details: {} })));
    store.load('t-1', 'skill-1');
    expect(store.status()).toBe('error');
  });

  it('canPublish is true only while a draft_version exists', () => {
    store.load('t-1', 'skill-1');
    expect(store.canPublish()).toBe(true);
  });

  it('nextVersionNumber is published + 1, or 1 when never published', () => {
    store.load('t-1', 'skill-1');
    expect(store.nextVersionNumber()).toBe(1);

    skillsApi.get.mockReturnValue(of(skill({ published_version: skillVersion({ version_number: 3 }) })));
    store.load('t-1', 'skill-1');
    expect(store.nextVersionNumber()).toBe(4);
  });

  it('testConfig wraps the skill id and current budget_ms into a single-skill-node draft config', () => {
    store.load('t-1', 'skill-1');
    const config = store.testConfig() as { reasoning: { graph: { skill_id: string; budget_ms: number }[] } };
    expect(config.reasoning.graph[0].skill_id).toBe('skill-1');
    expect(config.reasoning.graph[0].budget_ms).toBe(1340);
  });

  it('patchDraft marks dirty immediately and debounces the autosave PATCH call', fakeAsync(() => {
    store.load('t-1', 'skill-1');
    skillsApi.updateDraft.mockReturnValue(of(skill({ draft_version: skillVersion({ description: 'Updated' }) })));

    store.patchDraft({ description: 'Updated' });
    expect(store.dirty()).toBe(true);
    expect(skillsApi.updateDraft).not.toHaveBeenCalled();

    tick(400);
    expect(skillsApi.updateDraft).toHaveBeenCalledTimes(1);
    expect(skillsApi.updateDraft).toHaveBeenCalledWith('t-1', 'skill-1', expect.objectContaining({ description: 'Updated' }));
    expect(store.dirty()).toBe(false);
  }));

  it('coalesces rapid edits into a single autosave call (distinctUntilChanged debounce, same pattern as reasoning.store.ts)', fakeAsync(() => {
    store.load('t-1', 'skill-1');
    skillsApi.updateDraft.mockReturnValue(of(skill()));

    store.patchDraft({ description: 'A' });
    tick(100);
    store.patchDraft({ description: 'AB' });
    tick(100);
    store.patchDraft({ description: 'ABC' });
    tick(400);

    expect(skillsApi.updateDraft).toHaveBeenCalledTimes(1);
    expect(skillsApi.updateDraft).toHaveBeenCalledWith('t-1', 'skill-1', expect.objectContaining({ description: 'ABC' }));
  }));

  it('fires a second, separate autosave after a later independent edit burst (regression: no distinctUntilChanged starvation on a void Subject)', fakeAsync(() => {
    store.load('t-1', 'skill-1');
    skillsApi.updateDraft.mockReturnValue(of(skill()));

    store.patchDraft({ description: 'first edit' });
    tick(400);
    expect(skillsApi.updateDraft).toHaveBeenCalledTimes(1);

    store.patchDraft({ description: 'second, later edit' });
    tick(400);
    expect(skillsApi.updateDraft).toHaveBeenCalledTimes(2);
    expect(skillsApi.updateDraft).toHaveBeenLastCalledWith('t-1', 'skill-1', expect.objectContaining({ description: 'second, later edit' }));
  }));

  it('saveDraft flushes immediately without waiting for the debounce', () => {
    store.load('t-1', 'skill-1');
    skillsApi.updateDraft.mockReturnValue(of(skill()));
    store.patchDraft({ description: 'Updated' });
    const onSuccess = jest.fn();

    store.saveDraft(onSuccess);

    expect(skillsApi.updateDraft).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalled();
  });

  it('sets saveError on a failed autosave and calls onError for a manual save', () => {
    store.load('t-1', 'skill-1');
    skillsApi.updateDraft.mockReturnValue(throwError(() => ({ code: 'SKILL_TOOL_REF_UNKNOWN', message: 'Unknown tool.', status: 400, details: {} })));
    const onError = jest.fn();

    store.saveDraft(undefined, onError);

    expect(store.saveError()).toBe('Unknown tool.');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'SKILL_TOOL_REF_UNKNOWN' }));
    expect(store.saving()).toBe(false);
  });

  it('publish calls the publish endpoint and re-seeds the draft from the response', () => {
    store.load('t-1', 'skill-1');
    skillsApi.publish.mockReturnValue(
      of({ skill: skill({ draft_version: null, published_version: skillVersion({ version_number: 1 }) }) }),
    );
    const onSuccess = jest.fn();

    store.publish(onSuccess);

    expect(skillsApi.publish).toHaveBeenCalledWith('t-1', 'skill-1');
    expect(store.canPublish()).toBe(false);
    expect(onSuccess).toHaveBeenCalled();
  });

  it('publish calls onError on failure (e.g. SKILL_INSTRUCTIONS_REQUIRED)', () => {
    store.load('t-1', 'skill-1');
    skillsApi.publish.mockReturnValue(
      throwError(() => ({ code: 'SKILL_INSTRUCTIONS_REQUIRED', message: 'x', status: 422, details: {} })),
    );
    const onError = jest.fn();

    store.publish(undefined, onError);

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'SKILL_INSTRUCTIONS_REQUIRED' }));
    expect(store.publishing()).toBe(false);
  });

  it('fetchUsage reports the used_by_agent_count', () => {
    store.load('t-1', 'skill-1');
    skillsApi.usage.mockReturnValue(of({ used_by_agent_count: 2 }));
    const onResult = jest.fn();

    store.fetchUsage(onResult);

    expect(skillsApi.usage).toHaveBeenCalledWith('t-1', 'skill-1');
    expect(onResult).toHaveBeenCalledWith(2);
  });
});
