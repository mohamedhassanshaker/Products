import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { TenantsApiService } from '@liveavatar/web-shared';
import { KnowledgeSourcesPageComponent } from './knowledge-sources-page.component';
import { KnowledgeSourcesStore } from '../../store/knowledge-sources.store';

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

describe('KnowledgeSourcesPageComponent', () => {
  let fixture: ComponentFixture<KnowledgeSourcesPageComponent>;
  let component: KnowledgeSourcesPageComponent;
  let store: {
    load: jest.Mock;
    items: jest.Mock;
    status: jest.Mock;
    loadError: jest.Mock;
    mutating: jest.Mock;
    reindexingId: jest.Mock;
    remove: jest.Mock;
    estimateReindex: jest.Mock;
    triggerReindex: jest.Mock;
  };
  let tenantsApi: { get: jest.Mock };
  let dialog: { open: jest.Mock };
  let snackBar: { open: jest.Mock };

  function makeStore(items: unknown[]) {
    return {
      load: jest.fn(),
      items: jest.fn(() => items),
      status: jest.fn(() => 'ready'),
      loadError: jest.fn(() => null),
      mutating: jest.fn(() => false),
      reindexingId: jest.fn(() => null),
      remove: jest.fn(),
      estimateReindex: jest.fn(),
      triggerReindex: jest.fn(),
    };
  }

  async function setup(items = [source()]) {
    store = makeStore(items);
    tenantsApi = { get: jest.fn(() => of({ id: 't-1', name: 'Acme' })) };
    dialog = { open: jest.fn() };
    snackBar = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [KnowledgeSourcesPageComponent, NoopAnimationsModule],
      providers: [
        { provide: KnowledgeSourcesStore, useValue: store },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't-1' }) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(KnowledgeSourcesPageComponent);
    component = fixture.componentInstance;
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  }

  it('loads the registry for the route tenant id', async () => {
    await setup();
    expect(store.load).toHaveBeenCalledWith('t-1');
  });

  it('renders a table row per store item', async () => {
    await setup([source(), source({ id: 'src-2', name: 'Policies' })]);
    const rows = fixture.nativeElement.querySelectorAll('tr[mat-row]');
    expect(rows.length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('Handbook');
    expect(fixture.nativeElement.textContent).toContain('Policies');
  });

  it('shows the staleness badge only for stale rows', async () => {
    await setup([source({ id: 'src-1', is_stale: false }), source({ id: 'src-2', name: 'Policies', is_stale: true })]);
    const badges = fixture.nativeElement.querySelectorAll('.la-staleness-badge');
    expect(badges.length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('Stale — source changed since last index');
  });

  it('redirects to Deployments when tenantId is missing from the route', async () => {
    store = makeStore([]);
    tenantsApi = { get: jest.fn(() => throwError(() => ({ code: 'TENANT_NOT_FOUND', message: 'x', status: 404, details: {} }))) };
    await TestBed.configureTestingModule({
      imports: [KnowledgeSourcesPageComponent, NoopAnimationsModule],
      providers: [
        { provide: KnowledgeSourcesStore, useValue: store },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: MatDialog, useValue: { open: jest.fn() } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KnowledgeSourcesPageComponent);
    const router = TestBed.inject(Router);
    const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
    expect(navigateSpy).toHaveBeenCalledWith(['/deployments']);
  });

  it('deletes a source after confirm', async () => {
    await setup();
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    store.remove.mockImplementation((_id, onSuccess: () => void) => onSuccess());
    component.deleteSource(source());
    expect(store.remove).toHaveBeenCalledWith('src-1', expect.any(Function), expect.any(Function));
  });

  describe('re-index preview/confirm flow', () => {
    const estimate = { chunk_count: 12, estimated_cost_usd: 0.000048, estimated_duration_ms: 600, is_estimate: true as const };

    it('estimates, shows the estimate (explicitly labelled) in the confirm dialog, and triggers only on confirm', async () => {
      await setup();
      store.estimateReindex.mockResolvedValue(estimate);
      store.triggerReindex.mockResolvedValue(undefined);
      dialog.open.mockReturnValue({ afterClosed: () => of(true) });

      await component.reindex(source());

      expect(store.estimateReindex).toHaveBeenCalledWith('src-1');
      expect(dialog.open).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          data: expect.objectContaining({
            confirmLabel: 'Re-index',
            body: expect.stringContaining('12'),
          }),
        }),
      );
      const dialogBody = dialog.open.mock.calls[0][1].data.body as string;
      // Security/UX requirement: the estimate must never be presented as a precise fact.
      expect(dialogBody).toContain('Estimate');
      expect(dialogBody).toContain('~$0.0000');
      expect(dialogBody).toContain('~1s');
      expect(store.triggerReindex).toHaveBeenCalledWith('src-1');
      expect(snackBar.open).toHaveBeenCalledWith('Re-index started.', 'Dismiss', expect.any(Object));
    });

    it('does not trigger a reindex when the confirm dialog is dismissed', async () => {
      await setup();
      store.estimateReindex.mockResolvedValue(estimate);
      dialog.open.mockReturnValue({ afterClosed: () => of(false) });

      await component.reindex(source());

      expect(store.estimateReindex).toHaveBeenCalledWith('src-1');
      expect(store.triggerReindex).not.toHaveBeenCalled();
    });

    it('does not open the confirm dialog when the estimate call fails', async () => {
      await setup();
      store.estimateReindex.mockRejectedValue({ code: 'KNOWLEDGE_SOURCE_NOT_FOUND', message: 'x', status: 404, details: {} });

      await component.reindex(source());

      expect(dialog.open).not.toHaveBeenCalled();
      expect(store.triggerReindex).not.toHaveBeenCalled();
      expect(snackBar.open).toHaveBeenCalledWith('Could not estimate this re-index. Try again.', 'Dismiss', expect.any(Object));
    });
  });
});
