import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { TenantsApiService } from '@liveavatar/web-shared';
import type { GraphNode } from '@liveavatar/contracts';
import { ReasoningPageComponent } from './reasoning-page.component';
import { ReasoningStore } from '../../store/reasoning.store';

function llmNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'llm-1',
    type: 'llm',
    name: 'Answer',
    lane: 'foreground',
    on_error: { action: 'degrade' },
    on_deadline: { action: 'degrade' },
    provider: 'openai',
    model: 'gpt-4o-mini',
    retry: { max_attempts: 3, backoff_ms: [200, 400, 800] },
    next_node_id: null,
    ...overrides,
  } as GraphNode;
}

function reasoning(graph: GraphNode[] = [llmNode()]) {
  return { graph, entry_node_id: graph[0]?.id ?? '', background_entry_node_ids: [], turn_budget_ms: 3000 };
}

describe('ReasoningPageComponent', () => {
  let fixture: ComponentFixture<ReasoningPageComponent>;
  let component: ReasoningPageComponent;
  let store: ReturnType<typeof makeStore>;
  let tenantsApi: { get: jest.Mock };
  let dialog: { open: jest.Mock };
  let snackBar: { open: jest.Mock };

  function makeStore(overrides: Record<string, jest.Mock> = {}) {
    return {
      load: jest.fn(),
      status: jest.fn(() => 'ready'),
      loadError: jest.fn(() => null),
      reasoning: jest.fn(() => reasoning()),
      draftConfig: jest.fn(() => ({ reasoning: reasoning() })),
      agent: jest.fn(() => ({})),
      errorsByLayer: jest.fn(() => new Map()),
      definitions: jest.fn(() => []),
      credentials: jest.fn(() => []),
      tools: jest.fn(() => []),
      skills: jest.fn(() => []),
      gates: jest.fn(() => []),
      tenants: jest.fn(() => []),
      dirty: jest.fn(() => false),
      saving: jest.fn(() => null),
      canPublish: jest.fn(() => false),
      criticalPath: jest.fn(() => null),
      hasUnpublishedChanges: jest.fn(() => false),
      configStatus: jest.fn(() => 'draft'),
      validating: jest.fn(() => false),
      saveAlert: jest.fn(() => null),
      conflict: jest.fn(() => false),
      errorsByNode: jest.fn(() => new Map()),
      globalErrors: jest.fn(() => []),
      addNode: jest.fn(),
      updateNode: jest.fn(),
      removeNode: jest.fn(),
      setEntryNodeId: jest.fn(),
      setTurnBudgetMs: jest.fn(),
      setRuntime: jest.fn(),
      setSystemPrompt: jest.fn(),
      setMemoryEnabled: jest.fn(),
      setMemoryWindowTurns: jest.fn(),
      saveDraft: jest.fn(),
      publish: jest.fn(),
      reloadAfterConflict: jest.fn(),
      initializeDefaultGraph: jest.fn(),
      ...overrides,
    };
  }

  async function setup(storeOverrides: Record<string, jest.Mock> = {}, dialogOverride?: { open: jest.Mock }) {
    store = makeStore(storeOverrides);
    tenantsApi = { get: jest.fn(() => of({ id: 't-1', name: 'Acme' })) };
    dialog = dialogOverride ?? { open: jest.fn() };
    snackBar = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [ReasoningPageComponent, NoopAnimationsModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ReasoningStore, useValue: store },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't-1' }) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReasoningPageComponent);
    component = fixture.componentInstance;
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  }

  it('loads the reasoning store for the route tenant id', async () => {
    await setup();
    expect(store.load).toHaveBeenCalledWith('t-1');
  });

  it('shows the empty-state setup form when reasoning() is null (R-G1, brand-new tenant)', async () => {
    await setup({ reasoning: jest.fn(() => null) });
    expect(fixture.nativeElement.textContent).toContain('Set up the reasoning graph');
    expect(fixture.nativeElement.querySelector('.la-reasoning-empty-form')).toBeTruthy();
  });

  it('createDefaultGraph calls the store once a provider and model are chosen', async () => {
    await setup({ reasoning: jest.fn(() => null) });
    component.emptyStateProvider.set('openai');
    component.emptyStateModel.set('gpt-4o-mini');
    component.createDefaultGraph();
    expect(store.initializeDefaultGraph).toHaveBeenCalledWith({ provider: 'openai', model: 'gpt-4o-mini' });
  });

  it('renders the node list as a role="list" with one listitem per node', async () => {
    await setup({ reasoning: jest.fn(() => reasoning([llmNode(), llmNode({ id: 'end-1', type: 'end' })])) });
    const list = fixture.nativeElement.querySelector('.la-reasoning-nodes');
    expect(list.getAttribute('role')).toBe('list');
    expect(list.querySelectorAll('[role="listitem"]')).toHaveLength(2);
  });

  it('addNode adds the node then opens its inspector', async () => {
    await setup(
      { addNode: jest.fn(() => 'end-1'), reasoning: jest.fn(() => reasoning([llmNode(), llmNode({ id: 'end-1', type: 'end' })])) },
      { open: jest.fn(() => ({ afterClosed: () => of(undefined) })) },
    );

    component.addNode('end');

    expect(store.addNode).toHaveBeenCalledWith('end');
    expect(dialog.open).toHaveBeenCalled();
  });

  it('openInspector updates the node on a save result', async () => {
    const updated = llmNode({ name: 'Renamed' });
    await setup({}, { open: jest.fn(() => ({ afterClosed: () => of(updated) })) });

    component.openInspector('llm-1');

    expect(store.updateNode).toHaveBeenCalledWith('llm-1', updated);
  });

  it('deleteNode removes the node after confirmation', async () => {
    await setup({}, { open: jest.fn(() => ({ afterClosed: () => of(true) })) });

    component.deleteNode(llmNode());

    expect(store.removeNode).toHaveBeenCalledWith('llm-1');
  });

  it('deleteNode does nothing when the confirm dialog is dismissed', async () => {
    await setup({}, { open: jest.fn(() => ({ afterClosed: () => of(false) })) });

    component.deleteNode(llmNode());

    expect(store.removeNode).not.toHaveBeenCalled();
  });

  it('computes the UTF-8 byte length of the system prompt, not the character count (Phase 16 Core instructions)', async () => {
    await setup({ agent: jest.fn(() => ({ system_prompt: 'hello' })) });
    expect(component.promptByteLength()).toBe('hello'.length);
    expect(component.promptOverLimit()).toBe(false);
  });

  it('flags the prompt as over-limit using byte length, not character count', async () => {
    await setup({ agent: jest.fn(() => ({ system_prompt: '🙂'.repeat(9000) })) });
    expect(component.promptOverLimit()).toBe(true);
  });

  it('errorsForLayer maps the store errorsByLayer map to message strings', async () => {
    await setup({
      errorsByLayer: jest.fn(
        () => new Map([['agent.system_prompt', [{ code: 'CONFIG_PROMPT_TOO_LARGE', message: 'Too large.' }]]]),
      ),
    });
    expect(component.errorsForLayer('agent.system_prompt')).toEqual(['Too large.']);
    expect(component.errorsForLayer('avatar')).toEqual([]);
  });

  it('Core instructions field handlers delegate to the store', async () => {
    await setup();
    component.onRuntime('pydantic-ai');
    expect(store.setRuntime).toHaveBeenCalledWith('pydantic-ai');
    component.onSystemPrompt('You are a helpful agent.');
    expect(store.setSystemPrompt).toHaveBeenCalledWith('You are a helpful agent.');
    component.onMemoryEnabled(true);
    expect(store.setMemoryEnabled).toHaveBeenCalledWith(true);
    component.onMemoryWindow(24);
    expect(store.setMemoryWindowTurns).toHaveBeenCalledWith(24);
  });

  it('saveDraft/publish call the store with a success callback', async () => {
    await setup();
    component.saveDraft();
    expect(store.saveDraft).toHaveBeenCalledWith(expect.any(Function));
    component.publish();
    expect(store.publish).toHaveBeenCalledWith(expect.any(Function));
  });

  it('reload skips the confirm dialog when the draft is not dirty', async () => {
    await setup({ dirty: jest.fn(() => false) });
    component.reload();
    expect(store.reloadAfterConflict).toHaveBeenCalledTimes(1);
  });

  it('redirects to Deployments when tenantId is missing from the route', async () => {
    store = makeStore();
    tenantsApi = { get: jest.fn(() => throwError(() => ({ code: 'TENANT_NOT_FOUND', message: 'x', status: 404, details: {} }))) };
    await TestBed.configureTestingModule({
      imports: [ReasoningPageComponent, NoopAnimationsModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ReasoningStore, useValue: store },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: MatDialog, useValue: { open: jest.fn() } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ReasoningPageComponent);
    const router = TestBed.inject(Router);
    const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
    expect(navigateSpy).toHaveBeenCalledWith(['/deployments']);
  });
});
