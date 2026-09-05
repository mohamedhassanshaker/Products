import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import type { AppClientError, TenantListResponse } from '@liveavatar/web-shared';
import { DeploymentsListPageComponent } from './deployments-list-page.component';
import { DeploymentsService } from '../../services/deployments.service';
import { AuthStore } from '../../../../core/auth/auth.store';
import { CONVERSATION_APP_ORIGIN } from '../../../../core/conversation-app-origin.token';

function response(overrides: Partial<TenantListResponse> = {}): TenantListResponse {
  return {
    items: [
      { id: 't-1', name: 'Acme', slug: 'acme', status: 'active', provider_stack_summary: '', updated_at: '2026-08-19T10:00:00.000Z' },
    ],
    total: 1,
    page: 1,
    page_size: 25,
    ...overrides,
  };
}

describe('DeploymentsListPageComponent', () => {
  let fixture: ComponentFixture<DeploymentsListPageComponent>;
  let component: DeploymentsListPageComponent;
  let deployments: { list: jest.Mock; changeStatus: jest.Mock; get: jest.Mock; create: jest.Mock; rename: jest.Mock };
  let dialog: { open: jest.Mock };
  let snackBar: { open: jest.Mock };
  let authStore: { isOperator: jest.Mock; isAdmin: jest.Mock };

  async function setup(isOperator = true, conversationOrigin?: string) {
    deployments = {
      list: jest.fn(() => of(response())),
      changeStatus: jest.fn(() => of({})),
      get: jest.fn(),
      create: jest.fn(),
      rename: jest.fn(),
    };
    dialog = { open: jest.fn() };
    snackBar = { open: jest.fn() };
    authStore = { isOperator: jest.fn(() => isOperator), isAdmin: jest.fn(() => !isOperator) };

    await TestBed.configureTestingModule({
      imports: [DeploymentsListPageComponent, NoopAnimationsModule],
      providers: [
        { provide: DeploymentsService, useValue: deployments },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: AuthStore, useValue: authStore },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
        ...(conversationOrigin !== undefined ? [{ provide: CONVERSATION_APP_ORIGIN, useValue: conversationOrigin }] : []),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DeploymentsListPageComponent);
    component = fixture.componentInstance;
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  }

  it('fetches page 1 with default page size on init', async () => {
    await setup();
    fixture.detectChanges();
    expect(deployments.list).toHaveBeenCalledWith({ q: undefined, status: undefined, page: 1, page_size: 25 });
    expect(component.items()).toHaveLength(1);
    expect(component.loading()).toBe(false);
  });

  it('sets data-label on every cell so the phone stacked-card CSS has a label to render (D-3)', async () => {
    await setup();
    fixture.detectChanges();
    const cells: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('td[mat-cell]'));
    expect(cells.length).toBeGreaterThan(0);
    const labels = cells.map((cell) => cell.getAttribute('data-label'));
    expect(labels).toEqual(['Name', 'Slug', 'Providers', 'Status', 'Last modified', 'Actions']);
    expect(labels.every((label) => !!label)).toBe(true);
  });

  it('shows the operator empty-state with a Create action when there are zero tenants and no filters', async () => {
    await setup(true);
    deployments.list.mockReturnValue(of(response({ items: [], total: 0 })));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No deployments yet');
  });

  it('shows the assigned-admin empty-state (no Create action) when there are zero tenants', async () => {
    await setup(false);
    deployments.list.mockReturnValue(of(response({ items: [], total: 0 })));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No deployments assigned');
  });

  it('shows the filtered empty-state when filters produce zero results', async () => {
    await setup();
    deployments.list.mockReturnValue(of(response({ items: [], total: 0 })));
    fixture.detectChanges();
    component.searchControl.setValue('nomatch');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No matching deployments');
  });

  it('shows the error empty-state with Retry on a load failure', async () => {
    await setup();
    const error: AppClientError = { status: 0, code: 'NETWORK_ERROR', message: 'Network error.', details: {} };
    deployments.list.mockReturnValue(throwError(() => error));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Could not load deployments');
    expect(component.loadError()).toBe(error);
  });

  it('debounces the search input before refetching', async () => {
    jest.useFakeTimers();
    await setup();
    fixture.detectChanges();
    deployments.list.mockClear();
    component.searchControl.setValue('ac');
    jest.advanceTimersByTime(100);
    component.searchControl.setValue('acme');
    jest.advanceTimersByTime(299);
    expect(deployments.list).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(deployments.list).toHaveBeenCalledWith({ q: 'acme', status: undefined, page: 1, page_size: 25 });
    jest.useRealTimers();
  });

  it('resets page_size to 25 and retries on PAGE_SIZE_INVALID', async () => {
    await setup();
    const error: AppClientError = { status: 400, code: 'PAGE_SIZE_INVALID', message: 'page_size must be between 1 and 100.', details: {} };
    deployments.list.mockReturnValueOnce(throwError(() => error)).mockReturnValueOnce(of(response()));
    fixture.detectChanges();
    expect(component.pageSize()).toBe(25);
    expect(snackBar.open).toHaveBeenCalledWith('page_size must be between 1 and 100.', 'Dismiss', { duration: 6000 });
  });

  it('opens the create dialog and refreshes on success', async () => {
    await setup();
    fixture.detectChanges();
    deployments.list.mockClear();
    dialog.open.mockReturnValue({ afterClosed: () => of({ id: 't-2' }) });
    component.openCreateDialog();
    expect(snackBar.open).toHaveBeenCalledWith('Deployment created.', 'Dismiss', { duration: 6000 });
    expect(deployments.list).toHaveBeenCalled();
  });

  it('pauses an active tenant after confirmation and refreshes', async () => {
    await setup();
    fixture.detectChanges();
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    component.pauseOrActivate(response().items[0]);
    expect(deployments.changeStatus).toHaveBeenCalledWith('t-1', { status: 'paused' });
    expect(snackBar.open).toHaveBeenCalledWith('Deployment paused.', 'Dismiss', { duration: 6000 });
  });

  it('does nothing when the pause/activate confirm dialog is cancelled', async () => {
    await setup();
    fixture.detectChanges();
    dialog.open.mockReturnValue({ afterClosed: () => of(false) });
    component.pauseOrActivate(response().items[0]);
    expect(deployments.changeStatus).not.toHaveBeenCalled();
  });

  it('activates a paused tenant after confirmation', async () => {
    await setup();
    fixture.detectChanges();
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    component.pauseOrActivate({ ...response().items[0], status: 'paused' });
    expect(deployments.changeStatus).toHaveBeenCalledWith('t-1', { status: 'active' });
    expect(snackBar.open).toHaveBeenCalledWith('Deployment activated.', 'Dismiss', { duration: 6000 });
  });

  it('shows a snackbar when pause/activate fails', async () => {
    await setup();
    fixture.detectChanges();
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    const error: AppClientError = { status: 403, code: 'TENANT_FORBIDDEN', message: 'You are not assigned to this tenant.', details: {} };
    deployments.changeStatus.mockReturnValue(throwError(() => error));
    component.pauseOrActivate(response().items[0]);
    expect(snackBar.open).toHaveBeenCalledWith('You are not assigned to this tenant.', 'Dismiss', { duration: 6000 });
  });

  it('refetches when the status filter changes', async () => {
    await setup();
    fixture.detectChanges();
    deployments.list.mockClear();
    component.statusControl.setValue('paused');
    expect(deployments.list).toHaveBeenCalledWith({ q: undefined, status: 'paused', page: 1, page_size: 25 });
  });

  it('clearFilters resets search, status, and page then refetches', async () => {
    await setup();
    fixture.detectChanges();
    component.searchControl.setValue('acme', { emitEvent: false });
    component.statusControl.setValue('active', { emitEvent: false });
    component.page.set(3);
    deployments.list.mockClear();
    component.clearFilters();
    expect(component.searchControl.value).toBe('');
    expect(component.statusControl.value).toBe('all');
    expect(component.page()).toBe(1);
    expect(deployments.list).toHaveBeenCalledWith({ q: undefined, status: undefined, page: 1, page_size: 25 });
  });

  it('retry() refetches the list', async () => {
    await setup();
    fixture.detectChanges();
    deployments.list.mockClear();
    component.retry();
    expect(deployments.list).toHaveBeenCalled();
  });

  it('opens the rename dialog with the row data and refreshes on success', async () => {
    await setup();
    fixture.detectChanges();
    deployments.list.mockClear();
    dialog.open.mockReturnValue({ afterClosed: () => of({ id: 't-1', name: 'Renamed' }) });
    component.openRenameDialog(response().items[0]);
    expect(dialog.open).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ data: { id: 't-1', name: 'Acme', slug: 'acme', updatedAt: '2026-08-19T10:00:00.000Z' } }),
    );
    expect(snackBar.open).toHaveBeenCalledWith('Deployment renamed.', 'Dismiss', { duration: 6000 });
    expect(deployments.list).toHaveBeenCalled();
  });

  it('does not refresh when the rename dialog is cancelled', async () => {
    await setup();
    fixture.detectChanges();
    deployments.list.mockClear();
    dialog.open.mockReturnValue({ afterClosed: () => of(undefined) });
    component.openRenameDialog(response().items[0]);
    expect(snackBar.open).not.toHaveBeenCalled();
    expect(deployments.list).not.toHaveBeenCalled();
  });

  it('goToBuilder navigates to the tenant builder route', async () => {
    await setup();
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    component.goToBuilder(response().items[0]);
    expect(router.navigate).toHaveBeenCalledWith(['/tenants', 't-1', 'builder']);
  });

  it('goToAlerts navigates to the tenant-scoped alerts route', async () => {
    await setup();
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    component.goToAlerts(response().items[0]);
    expect(router.navigate).toHaveBeenCalledWith(['/tenants', 't-1', 'alerts']);
  });

  it('goToResidency navigates to the tenant-scoped residency route', async () => {
    await setup();
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    component.goToResidency(response().items[0]);
    expect(router.navigate).toHaveBeenCalledWith(['/tenants', 't-1', 'residency']);
  });

  it('conversationLink builds a relative /c/:slug link by default (same-origin production)', async () => {
    await setup();
    fixture.detectChanges();
    expect(component.conversationLink(response().items[0])).toBe('/c/acme');
  });

  it('conversationLink honors an overridden CONVERSATION_APP_ORIGIN (e.g. a local dev setup)', async () => {
    await setup(true, 'http://localhost:4201');
    fixture.detectChanges();
    expect(component.conversationLink(response().items[0])).toBe('http://localhost:4201/c/acme');
  });

  it('paginator page/size changes update state and refetch', async () => {
    await setup();
    fixture.detectChanges();
    deployments.list.mockClear();
    component.onPageEvent({ pageIndex: 1, pageSize: 50, length: 100, previousPageIndex: 0 });
    expect(component.page()).toBe(2);
    expect(component.pageSize()).toBe(50);
    expect(deployments.list).toHaveBeenCalledWith({ q: undefined, status: undefined, page: 2, page_size: 50 });
  });

  it('relativeTime formats an ISO timestamp', async () => {
    await setup();
    expect(component.relativeTime('2026-08-19T10:00:00.000Z')).toEqual(expect.any(String));
  });
});
