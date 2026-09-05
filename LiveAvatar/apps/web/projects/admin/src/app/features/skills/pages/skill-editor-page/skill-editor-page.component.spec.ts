import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { TenantsApiService } from '@liveavatar/web-shared';
import { SkillEditorPageComponent } from './skill-editor-page.component';
import { SkillEditorStore } from '../../store/skill-editor.store';

function draft(overrides: Record<string, unknown> = {}) {
  return {
    name: 'refunds',
    description: 'Handle refund requests',
    instructions: 'Step 1: confirm the order.',
    trigger_mode: 'model' as const,
    tools: [],
    knowledge_filters: { source_refs: [] },
    budget_ms: 1340,
    hitl_gate_id: null,
    environments: ['dev', 'staging', 'production'],
    ...overrides,
  };
}

function skill(overrides: Record<string, unknown> = {}) {
  return {
    id: 'skill-1',
    tenant_id: 't-1',
    name: 'refunds',
    slug: 'refunds',
    draft_version: { id: 'v1', version_number: 1 },
    published_version: null,
    used_by_agent_count: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function testConfig() {
  return {
    version: 1,
    reasoning: { graph: [], entry_node_id: 'skill_under_test', background_entry_node_ids: [], turn_budget_ms: 3000 },
  };
}

describe('SkillEditorPageComponent', () => {
  let fixture: ComponentFixture<SkillEditorPageComponent>;
  let component: SkillEditorPageComponent;
  let store: ReturnType<typeof makeStore>;
  let tenantsApi: { get: jest.Mock };
  let dialog: { open: jest.Mock };
  let snackBar: { open: jest.Mock };

  function makeStore(overrides: Record<string, jest.Mock> = {}) {
    return {
      load: jest.fn(),
      status: jest.fn(() => 'ready'),
      loadError: jest.fn(() => null),
      skill: jest.fn(() => skill()),
      draft: jest.fn(() => draft()),
      dirty: jest.fn(() => false),
      saving: jest.fn(() => false),
      saveError: jest.fn(() => null),
      publishing: jest.fn(() => false),
      tools: jest.fn(() => []),
      gates: jest.fn(() => []),
      canPublish: jest.fn(() => true),
      nextVersionNumber: jest.fn(() => 1),
      testConfig: jest.fn(() => testConfig()),
      patchDraft: jest.fn(),
      saveDraft: jest.fn(),
      publish: jest.fn(),
      fetchUsage: jest.fn(),
      ...overrides,
    };
  }

  async function setup(storeOverrides: Record<string, jest.Mock> = {}, dialogOverride?: { open: jest.Mock }) {
    store = makeStore(storeOverrides);
    tenantsApi = { get: jest.fn(() => of({ id: 't-1', name: 'Acme' })) };
    dialog = dialogOverride ?? { open: jest.fn() };
    snackBar = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [SkillEditorPageComponent, NoopAnimationsModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SkillEditorStore, useValue: store },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't-1', skillId: 'skill-1' }) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SkillEditorPageComponent);
    component = fixture.componentInstance;
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  }

  it('shows the loading indicator while status is loading', async () => {
    await setup({ status: jest.fn(() => 'loading'), draft: jest.fn(() => null) });
    expect(fixture.nativeElement.querySelector('mat-progress-bar')).toBeTruthy();
  });

  it('loads the skill for the route tenant/skill ids', async () => {
    await setup();
    expect(store.load).toHaveBeenCalledWith('t-1', 'skill-1');
  });

  it('renders the draft fields and live counters (happy path)', async () => {
    await setup();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('tokens');
    expect(text).toContain('bytes');
    expect(fixture.nativeElement.querySelector('input')).toBeTruthy();
  });

  it('shows the not-found empty state', async () => {
    await setup({ status: jest.fn(() => 'not_found'), draft: jest.fn(() => null) });
    expect(fixture.nativeElement.textContent).toContain('Skill not found');
  });

  it('shows the load-error empty state with a retry action', async () => {
    await setup({ status: jest.fn(() => 'error'), draft: jest.fn(() => null) });
    expect(fixture.nativeElement.textContent).toContain('Could not load this skill');
    component.retry();
    expect(store.load).toHaveBeenCalledWith('t-1', 'skill-1');
  });

  it('onName/onDescription/onInstructions patch the corresponding draft field', async () => {
    await setup();
    component.onName('renamed');
    component.onDescription('new description');
    component.onInstructions('new instructions');
    expect(store.patchDraft).toHaveBeenCalledWith({ name: 'renamed' });
    expect(store.patchDraft).toHaveBeenCalledWith({ description: 'new description' });
    expect(store.patchDraft).toHaveBeenCalledWith({ instructions: 'new instructions' });
  });

  it('toggleTool attaches an unattached tool by api_ref', async () => {
    await setup({ draft: jest.fn(() => draft({ tools: [] })) });
    component.toggleTool({ id: 't-1', api_ref: 'lookup_order', name: 'Lookup order' } as never);
    expect(store.patchDraft).toHaveBeenCalledWith({ tools: ['lookup_order'] });
  });

  it('toggleTool detaches an already-attached tool', async () => {
    await setup({ draft: jest.fn(() => draft({ tools: ['lookup_order'] })) });
    component.toggleTool({ id: 't-1', api_ref: 'lookup_order', name: 'Lookup order' } as never);
    expect(store.patchDraft).toHaveBeenCalledWith({ tools: [] });
  });

  it('onSourceRefsChange trims, drops empties, and patches knowledge_filters.source_refs', async () => {
    await setup();
    component.onSourceRefsChange('returns-policy,  refunds-faq ,, ');
    expect(store.patchDraft).toHaveBeenCalledWith({ knowledge_filters: { source_refs: ['returns-policy', 'refunds-faq'] } });
  });

  it('toggleEnv adds a not-yet-enabled environment', async () => {
    await setup({ draft: jest.fn(() => draft({ environments: ['dev'] })) });
    component.toggleEnv('staging');
    expect(store.patchDraft).toHaveBeenCalledWith({ environments: ['dev', 'staging'] });
  });

  it('toggleEnv removes an enabled environment', async () => {
    await setup({ draft: jest.fn(() => draft({ environments: ['dev', 'staging'] })) });
    component.toggleEnv('staging');
    expect(store.patchDraft).toHaveBeenCalledWith({ environments: ['dev'] });
  });

  it('clicking Publish triggers the usage check, and publishes directly when used_by_agent_count is 0', async () => {
    await setup({ fetchUsage: jest.fn((onResult: (n: number) => void) => onResult(0)) });

    const publishButton = Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes('Publish'),
    ) as HTMLButtonElement;
    publishButton.click();

    expect(store.fetchUsage).toHaveBeenCalled();
    expect(dialog.open).not.toHaveBeenCalled();
    expect(store.publish).toHaveBeenCalled();
  });

  it('publish opens a confirm dialog naming the agent count, and only publishes when confirmed', async () => {
    await setup(
      { fetchUsage: jest.fn((onResult: (n: number) => void) => onResult(2)) },
      { open: jest.fn(() => ({ afterClosed: () => of(true) })) },
    );

    component.publish();

    expect(dialog.open).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ data: expect.objectContaining({ body: expect.stringContaining('used by 2 agent(s)') }) }),
    );
    expect(store.publish).toHaveBeenCalled();
  });

  it('does not publish when the usage confirm dialog is dismissed', async () => {
    await setup(
      { fetchUsage: jest.fn((onResult: (n: number) => void) => onResult(2)) },
      { open: jest.fn(() => ({ afterClosed: () => of(false) })) },
    );

    component.publish();

    expect(store.publish).not.toHaveBeenCalled();
  });

  it('saveDraft delegates to the store with success/error callbacks', async () => {
    await setup();
    component.saveDraft();
    expect(store.saveDraft).toHaveBeenCalledWith(expect.any(Function), expect.any(Function));
  });

  it('redirects to Deployments when tenantId or skillId is missing from the route', async () => {
    store = makeStore();
    tenantsApi = { get: jest.fn(() => throwError(() => ({ code: 'TENANT_NOT_FOUND', message: 'x', status: 404, details: {} }))) };
    await TestBed.configureTestingModule({
      imports: [SkillEditorPageComponent, NoopAnimationsModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SkillEditorStore, useValue: store },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: MatDialog, useValue: { open: jest.fn() } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't-1' }) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SkillEditorPageComponent);
    const router = TestBed.inject(Router);
    const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
    expect(navigateSpy).toHaveBeenCalledWith(['/deployments']);
  });
});
