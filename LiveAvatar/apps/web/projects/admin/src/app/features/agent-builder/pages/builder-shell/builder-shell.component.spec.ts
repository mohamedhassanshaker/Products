import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, NavigationEnd, Router, convertToParamMap } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Subject, of } from 'rxjs';
import { BuilderShellComponent } from './builder-shell.component';
import { AgentBuilderStore } from '../../store/agent-builder.store';
import { ReasoningStore } from '../../../reasoning/store/reasoning.store';
import { ToolsStore } from '../../../tools/store/tools.store';
import { SkillsLibraryStore } from '../../../skills/store/skills-library.store';
import { KnowledgeSourcesStore } from '../../../knowledge/store/knowledge-sources.store';
import { HitlGatesStore } from '../../../hitl/store/hitl-gates.store';

describe('BuilderShellComponent', () => {
  let fixture: ComponentFixture<BuilderShellComponent>;
  let component: BuilderShellComponent;
  let store: {
    load: jest.Mock;
    tenantName: jest.Mock;
    status: jest.Mock;
    conflict: jest.Mock;
    configStatus: jest.Mock;
    hasUnpublishedChanges: jest.Mock;
    validating: jest.Mock;
    saveAlert: jest.Mock;
    dirty: jest.Mock;
    saving: jest.Mock;
    canPublish: jest.Mock;
    validateResult: jest.Mock;
    saveDraft: jest.Mock;
    publish: jest.Mock;
    reloadAfterConflict: jest.Mock;
  };
  let reasoningStore: { tenantId: jest.Mock; load: jest.Mock; reasoning: jest.Mock; criticalPath: jest.Mock; agent: jest.Mock };
  let toolsStore: { tenantId: jest.Mock; load: jest.Mock; items: jest.Mock; attachedRefs: jest.Mock };
  let skillsStore: { tenantId: jest.Mock; load: jest.Mock; items: jest.Mock };
  let knowledgeStore: { tenantId: jest.Mock; load: jest.Mock; items: jest.Mock };
  let hitlStore: { tenantId: jest.Mock; load: jest.Mock; items: jest.Mock };
  let routerEvents$: Subject<unknown>;
  let navigate: jest.Mock;
  let firstChildUrl: { path: string }[] | undefined;

  function setup(
    paramMap: Record<string, string> = { id: 't-1' },
    initialSegment: { path: string }[] = [{ path: 'overview' }],
    dialogOverride: { open: jest.Mock } = { open: jest.fn() },
  ): void {
    store = {
      load: jest.fn(),
      tenantName: jest.fn(() => 'Acme'),
      status: jest.fn(() => 'ready'),
      conflict: jest.fn(() => false),
      configStatus: jest.fn(() => 'draft'),
      hasUnpublishedChanges: jest.fn(() => false),
      validating: jest.fn(() => false),
      saveAlert: jest.fn(() => null),
      dirty: jest.fn(() => false),
      saving: jest.fn(() => null),
      canPublish: jest.fn(() => false),
      validateResult: jest.fn(() => ({ valid: false, errors: [], resolved: {}, redacted_yaml: 'version: 1\n' })),
      saveDraft: jest.fn(),
      publish: jest.fn(),
      reloadAfterConflict: jest.fn(),
    };
    reasoningStore = {
      tenantId: jest.fn(() => null),
      load: jest.fn(),
      reasoning: jest.fn(() => null),
      criticalPath: jest.fn(() => null),
      agent: jest.fn(() => ({})),
    };
    toolsStore = { tenantId: jest.fn(() => null), load: jest.fn(), items: jest.fn(() => []), attachedRefs: jest.fn(() => new Set()) };
    skillsStore = { tenantId: jest.fn(() => null), load: jest.fn(), items: jest.fn(() => []) };
    knowledgeStore = { tenantId: jest.fn(() => null), load: jest.fn(), items: jest.fn(() => []) };
    hitlStore = { tenantId: jest.fn(() => null), load: jest.fn(), items: jest.fn(() => []) };
    routerEvents$ = new Subject();
    navigate = jest.fn().mockResolvedValue(true);
    firstChildUrl = initialSegment;

    TestBed.configureTestingModule({
      imports: [BuilderShellComponent, NoopAnimationsModule],
      providers: [
        { provide: AgentBuilderStore, useValue: store },
        { provide: ReasoningStore, useValue: reasoningStore },
        { provide: ToolsStore, useValue: toolsStore },
        { provide: SkillsLibraryStore, useValue: skillsStore },
        { provide: KnowledgeSourcesStore, useValue: knowledgeStore },
        { provide: HitlGatesStore, useValue: hitlStore },
        { provide: MatDialog, useValue: dialogOverride },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        {
          provide: Router,
          useValue: { events: routerEvents$.asObservable(), navigate, createUrlTree: jest.fn(), serializeUrl: jest.fn() },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap(paramMap), get firstChild() { return firstChildUrl ? { url: firstChildUrl } : null; } },
          },
        },
      ],
    });

    fixture = TestBed.createComponent(BuilderShellComponent);
    component = fixture.componentInstance;
  }

  it('redirects to Deployments when tenantId is missing from the route', () => {
    setup({});
    fixture.detectChanges();
    expect(navigate).toHaveBeenCalledWith(['/deployments']);
    expect(store.load).not.toHaveBeenCalled();
  });

  it('loads the shared builder store once for the route tenant id', () => {
    setup();
    fixture.detectChanges();
    expect(store.load).toHaveBeenCalledWith('t-1');
  });

  it('loads each of the five other tabs\' stores only if not already loaded for this tenant', () => {
    setup();
    reasoningStore.tenantId.mockReturnValue('t-1');
    fixture.detectChanges();
    expect(reasoningStore.load).not.toHaveBeenCalled();
    expect(toolsStore.load).toHaveBeenCalledWith('t-1');
    expect(skillsStore.load).toHaveBeenCalledWith('t-1');
    expect(knowledgeStore.load).toHaveBeenCalledWith('t-1');
    expect(hitlStore.load).toHaveBeenCalledWith('t-1');
  });

  it('activeTabIndex resolves from the current child route segment', () => {
    setup({ id: 't-1' }, [{ path: 'reasoning' }]);
    fixture.detectChanges();
    expect(component.activeTabIndex()).toBe(component.tabs.findIndex((t) => t.path === 'reasoning'));
  });

  it('activeTabIndex resolves the Skills tab for a nested skill-detail child route', () => {
    setup({ id: 't-1' }, [{ path: 'skills' }, { path: 'skill-123' }]);
    fixture.detectChanges();
    expect(component.activeTabIndex()).toBe(component.tabs.findIndex((t) => t.path === 'skills'));
  });

  it('activeTabIndex updates on NavigationEnd', () => {
    setup();
    fixture.detectChanges();
    expect(component.activeTabIndex()).toBe(0);
    firstChildUrl = [{ path: 'tools' }];
    routerEvents$.next(new NavigationEnd(1, '/tenants/t-1/builder/tools', '/tenants/t-1/builder/tools'));
    expect(component.activeTabIndex()).toBe(component.tabs.findIndex((t) => t.path === 'tools'));
  });

  it('onTabIndexChange navigates to the tab path relative to the shell route', () => {
    setup();
    fixture.detectChanges();
    const dynamicsIndex = component.tabs.findIndex((t) => t.path === 'dynamics');
    component.onTabIndexChange(dynamicsIndex);
    expect(navigate).toHaveBeenCalledWith(['dynamics'], { relativeTo: expect.anything() });
  });

  it('saveDraft/publish call the shared store with a success callback', () => {
    setup();
    fixture.detectChanges();
    component.saveDraft();
    expect(store.saveDraft).toHaveBeenCalledWith(expect.any(Function));
    component.publish();
    expect(store.publish).toHaveBeenCalledWith(expect.any(Function));
  });

  it('reload skips the confirm dialog when the draft is not dirty', () => {
    setup();
    store.dirty.mockReturnValue(false);
    fixture.detectChanges();
    component.reload();
    expect(store.reloadAfterConflict).toHaveBeenCalledTimes(1);
  });

  it('reload opens a confirm dialog when the draft is dirty, and only reloads on confirm', () => {
    const dialog = { open: jest.fn(() => ({ afterClosed: () => of(true) })) };
    setup({ id: 't-1' }, [{ path: 'overview' }], dialog);
    store.dirty.mockReturnValue(true);
    fixture.detectChanges();
    component.reload();
    expect(dialog.open).toHaveBeenCalled();
    expect(store.reloadAfterConflict).toHaveBeenCalledTimes(1);
  });

  it('validationErrorCount/validationWarningCount split the shared validate result by severity', () => {
    setup();
    store.validateResult.mockReturnValue({
      valid: false,
      errors: [
        { code: 'A', message: 'a' },
        { code: 'B', message: 'b', severity: 'warning' },
      ],
      resolved: {},
      redacted_yaml: '',
    });
    fixture.detectChanges();
    expect(component.validationErrorCount()).toBe(1);
    expect(component.validationWarningCount()).toBe(1);
  });
});
