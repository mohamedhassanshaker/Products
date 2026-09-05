import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { TenantsApiService } from '@liveavatar/web-shared';
import { ToolsPageComponent } from './tools-page.component';
import { ToolsStore } from '../../store/tools.store';

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

describe('ToolsPageComponent', () => {
  let fixture: ComponentFixture<ToolsPageComponent>;
  let component: ToolsPageComponent;
  let toolsStore: {
    load: jest.Mock;
    items: jest.Mock;
    status: jest.Mock;
    loadError: jest.Mock;
    mutating: jest.Mock;
    testingId: jest.Mock;
    testResults: jest.Mock;
    remove: jest.Mock;
    testInvoke: jest.Mock;
    attachedRefs: jest.Mock;
    toggleAttach: jest.Mock;
  };
  let tenantsApi: { get: jest.Mock };
  let dialog: { open: jest.Mock };
  let snackBar: { open: jest.Mock };

  function makeToolsStore(items: unknown[], attachedRefs: string[]) {
    return {
      load: jest.fn(),
      items: jest.fn(() => items),
      status: jest.fn(() => 'ready'),
      loadError: jest.fn(() => null),
      mutating: jest.fn(() => false),
      testingId: jest.fn(() => null),
      testResults: jest.fn(() => ({})),
      remove: jest.fn(),
      testInvoke: jest.fn(),
      attachedRefs: jest.fn(() => new Set(attachedRefs)),
      toggleAttach: jest.fn(),
    };
  }

  async function setup(items = [tool()], attachedRefs: string[] = []) {
    toolsStore = makeToolsStore(items, attachedRefs);
    tenantsApi = { get: jest.fn(() => of({ id: 't-1', name: 'Acme' })) };
    dialog = { open: jest.fn() };
    snackBar = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [ToolsPageComponent, NoopAnimationsModule],
      providers: [
        { provide: ToolsStore, useValue: toolsStore },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't-1' }) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ToolsPageComponent);
    component = fixture.componentInstance;
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  }

  it('loads the registry (and its draft attach state) for the route tenant id', async () => {
    await setup();
    expect(toolsStore.load).toHaveBeenCalledWith('t-1');
  });

  it('reports a tool as attached only when it is in agent.tools[]', async () => {
    await setup([tool()], ['lookup_order']);
    expect(component.isAttached(tool())).toBe(true);
    expect(component.isAttached(tool({ api_ref: 'other' }))).toBe(false);
    expect(component.attachedTools()).toHaveLength(1);
  });

  it('flags over the recommended attach limit past 8 tools', async () => {
    const refs = Array.from({ length: 9 }, (_, i) => `tool_${i}`);
    const items = refs.map((ref) => tool({ id: ref, api_ref: ref }));
    await setup(items, refs);
    expect(component.attachedOverLimit()).toBe(true);
  });

  it('delegates attach/detach to the store and snackbars the result', async () => {
    await setup([tool()], []);
    toolsStore.toggleAttach.mockImplementation((_tool, onSuccess: (attached: boolean) => void) => onSuccess(true));

    component.toggleAttach(tool());

    expect(toolsStore.toggleAttach).toHaveBeenCalledWith(tool(), expect.any(Function), expect.any(Function));
    expect(snackBar.open).toHaveBeenCalledWith('Lookup order attached.', 'Dismiss', expect.any(Object));
  });

  it('lists consequential tools regardless of attach status', async () => {
    await setup([tool({ consequential: true }), tool({ id: 'tool-2', api_ref: 'x', consequential: false })]);
    expect(component.consequentialTools()).toHaveLength(1);
  });

  it('deletes a tool after confirm', async () => {
    await setup();
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    toolsStore.remove.mockImplementation((_id, onSuccess: () => void) => onSuccess());
    component.deleteTool(tool());
    expect(toolsStore.remove).toHaveBeenCalledWith('tool-1', expect.any(Function), expect.any(Function));
  });

  it('redirects to Deployments when tenantId is missing from the route', async () => {
    toolsStore = makeToolsStore([], []);
    tenantsApi = { get: jest.fn(() => throwError(() => ({ code: 'TENANT_NOT_FOUND', message: 'x', status: 404, details: {} }))) };
    await TestBed.configureTestingModule({
      imports: [ToolsPageComponent, NoopAnimationsModule],
      providers: [
        { provide: ToolsStore, useValue: toolsStore },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: MatDialog, useValue: { open: jest.fn() } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ToolsPageComponent);
    const router = TestBed.inject(Router);
    const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
    expect(navigateSpy).toHaveBeenCalledWith(['/deployments']);
  });
});
