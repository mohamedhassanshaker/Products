import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { TenantsApiService } from '@liveavatar/web-shared';
import { SkillsLibraryPageComponent } from './skills-library-page.component';
import { SkillsLibraryStore } from '../../store/skills-library.store';

function skillVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'version-1',
    version_number: 1,
    status: 'draft' as const,
    name: 'refunds',
    description: 'Handle refunds',
    instructions: '',
    trigger_mode: 'model' as const,
    tools: ['check_eligibility', 'issue_refund'],
    knowledge_filters: { source_refs: ['returns-policy'] },
    budget_ms: 1340,
    hitl_gate_id: null,
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
    used_by_agent_count: 2,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('SkillsLibraryPageComponent', () => {
  let fixture: ComponentFixture<SkillsLibraryPageComponent>;
  let component: SkillsLibraryPageComponent;
  let store: {
    load: jest.Mock;
    items: jest.Mock;
    status: jest.Mock;
    loadError: jest.Mock;
    mutating: jest.Mock;
    remove: jest.Mock;
    create: jest.Mock;
  };
  let tenantsApi: { get: jest.Mock };
  let dialog: { open: jest.Mock };
  let snackBar: { open: jest.Mock };

  function makeStore(items: unknown[], status: string) {
    return {
      load: jest.fn(),
      items: jest.fn(() => items),
      status: jest.fn(() => status),
      loadError: jest.fn(() => null),
      mutating: jest.fn(() => false),
      remove: jest.fn(),
      create: jest.fn(),
    };
  }

  async function setup(items = [skill()], status = 'ready') {
    store = makeStore(items, status);
    tenantsApi = { get: jest.fn(() => of({ id: 't-1', name: 'Acme' })) };
    dialog = { open: jest.fn() };
    snackBar = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [SkillsLibraryPageComponent, NoopAnimationsModule],
      providers: [
        { provide: SkillsLibraryStore, useValue: store },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't-1' }) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SkillsLibraryPageComponent);
    component = fixture.componentInstance;
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  }

  it('shows the loading indicator while status is loading', async () => {
    await setup([], 'loading');
    expect(fixture.nativeElement.querySelector('mat-progress-bar')).toBeTruthy();
  });

  it('loads the registry for the route tenant id', async () => {
    await setup();
    expect(store.load).toHaveBeenCalledWith('t-1');
  });

  it('renders a row per skill with the computed table values (happy path)', async () => {
    await setup([skill()]);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('refunds');
    expect(text).toContain('draft only');
    expect(text).toContain('1 source');
    expect(text).toContain('1340ms');
    expect(text).toContain('2 agents');
  });

  it('computes tools/knowledge/budget from the draft version when one exists', async () => {
    await setup([skill()]);
    expect(component.toolsCount(skill())).toBe(2);
    expect(component.sourceRefsCount(skill())).toBe(1);
    expect(component.budgetMs(skill())).toBe(1340);
  });

  it('hasHitlGate reflects the current version\'s hitl_gate_id (Phase 14 follow-up)', async () => {
    await setup([skill()]);
    expect(component.hasHitlGate(skill())).toBe(false);
    expect(component.hasHitlGate(skill({ draft_version: skillVersion({ hitl_gate_id: 'gate-1' }) }))).toBe(true);
  });

  it('falls back to the published version when there is no draft', async () => {
    const published = skill({
      draft_version: null,
      published_version: skillVersion({ version_number: 3, tools: ['a'], knowledge_filters: { source_refs: [] } }),
    });
    await setup([published]);
    expect(component.toolsCount(published)).toBe(1);
    expect(component.sourceRefsCount(published)).toBe(0);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('v3');
  });

  it('shows the empty state with zero skills', async () => {
    await setup([]);
    expect(fixture.nativeElement.textContent).toContain('No skills yet');
  });

  it('opens the new-skill dialog and navigates to the editor route on success', async () => {
    await setup();
    dialog.open.mockReturnValue({ afterClosed: () => of({ id: 'skill-2' }) });
    const router = TestBed.inject(Router);

    component.openCreateDialog();

    expect(dialog.open).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['tenants', 't-1', 'skills', 'skill-2']);
  });

  it('does not navigate when the new-skill dialog is cancelled', async () => {
    await setup();
    dialog.open.mockReturnValue({ afterClosed: () => of(undefined) });
    const router = TestBed.inject(Router);
    (router.navigate as jest.Mock).mockClear();

    component.openCreateDialog();

    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('deletes a skill after confirm', async () => {
    await setup();
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    store.remove.mockImplementation((_id, onSuccess: () => void) => onSuccess());

    component.deleteSkill(skill());

    expect(store.remove).toHaveBeenCalledWith('skill-1', expect.any(Function), expect.any(Function));
    expect(snackBar.open).toHaveBeenCalledWith('Skill deleted.', 'Dismiss', expect.any(Object));
  });

  it('does not delete when the confirm dialog is dismissed', async () => {
    await setup();
    dialog.open.mockReturnValue({ afterClosed: () => of(false) });

    component.deleteSkill(skill());

    expect(store.remove).not.toHaveBeenCalled();
  });

  it('redirects to Deployments when tenantId is missing from the route', async () => {
    store = makeStore([], 'ready');
    tenantsApi = { get: jest.fn(() => of({ id: 't-1', name: 'Acme' })) };
    await TestBed.configureTestingModule({
      imports: [SkillsLibraryPageComponent, NoopAnimationsModule],
      providers: [
        { provide: SkillsLibraryStore, useValue: store },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: MatDialog, useValue: { open: jest.fn() } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SkillsLibraryPageComponent);
    const router = TestBed.inject(Router);
    const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
    expect(navigateSpy).toHaveBeenCalledWith(['/deployments']);
  });
});
