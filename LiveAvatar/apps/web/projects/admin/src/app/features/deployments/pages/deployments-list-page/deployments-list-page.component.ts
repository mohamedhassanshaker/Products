import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import type { TenantListItemDto } from '@liveavatar/contracts';
import {
  ConfirmDialogComponent,
  EmptyStateComponent,
  PageHeaderComponent,
  StatusChipComponent,
  formatRelativeTime,
  type AppClientError,
} from '@liveavatar/web-shared';
import { AuthStore } from '../../../../core/auth/auth.store';
import { CONVERSATION_APP_ORIGIN } from '../../../../core/conversation-app-origin.token';
import { DeploymentsService } from '../../services/deployments.service';
import { CreateTenantDialogComponent } from '../../components/create-tenant-dialog/create-tenant-dialog.component';
import { RenameTenantDialogComponent } from '../../components/rename-tenant-dialog/rename-tenant-dialog.component';

type StatusFilter = 'all' | 'active' | 'paused';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

/** Deployments list — Screen 3 (FR-TENANT-1..4, FR-CONFIG-5, UX_GUIDELINES §5). */
@Component({
  selector: 'la-deployments-list-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    PageHeaderComponent,
    EmptyStateComponent,
    StatusChipComponent,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTableModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './deployments-list-page.component.html',
  styleUrl: './deployments-list-page.component.scss',
})
export class DeploymentsListPageComponent implements OnInit {
  private readonly deployments = inject(DeploymentsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly conversationAppOrigin = inject(CONVERSATION_APP_ORIGIN);
  readonly authStore = inject(AuthStore);

  readonly displayedColumns = ['name', 'slug', 'providers', 'status', 'updatedAt', 'actions'];
  readonly pageSizeOptions = PAGE_SIZE_OPTIONS;

  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly statusControl = new FormControl<StatusFilter>('all', { nonNullable: true });

  readonly items = signal<TenantListItemDto[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly pageSize = signal<number>(DEFAULT_PAGE_SIZE);
  readonly loading = signal(true);
  readonly loadError = signal<AppClientError | null>(null);

  /**
   * Plain methods, not `computed()`: reading `FormControl.value` does not
   * register as a signal dependency, so a computed() here would freeze
   * after its first evaluation. The template re-evaluates these every
   * change-detection pass.
   */
  hasActiveFilters(): boolean {
    return this.searchControl.value.trim().length > 0 || this.statusControl.value !== 'all';
  }

  createDisabled(): boolean {
    return this.authStore.isOperator() && !this.hasActiveFilters() && this.total() >= 500;
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    this.searchControl.setValue(params.get('q') ?? '', { emitEvent: false });
    const status = params.get('status');
    this.statusControl.setValue(status === 'active' || status === 'paused' ? status : 'all', { emitEvent: false });
    this.page.set(Number(params.get('page') ?? '1') || 1);
    this.pageSize.set(Number(params.get('page_size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE);

    this.searchControl.valueChanges.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => {
      this.page.set(1);
      this.syncUrlAndFetch();
    });

    this.statusControl.valueChanges.subscribe(() => {
      this.page.set(1);
      this.syncUrlAndFetch();
    });

    this.fetch();
  }

  onPageEvent(event: PageEvent): void {
    this.page.set(event.pageIndex + 1);
    this.pageSize.set(event.pageSize);
    this.syncUrlAndFetch();
  }

  clearFilters(): void {
    this.searchControl.setValue('', { emitEvent: false });
    this.statusControl.setValue('all', { emitEvent: false });
    this.page.set(1);
    this.syncUrlAndFetch();
  }

  retry(): void {
    this.fetch();
  }

  relativeTime(iso: string): string {
    return formatRelativeTime(iso);
  }

  openCreateDialog(): void {
    const ref = this.dialog.open(CreateTenantDialogComponent, { width: '480px' });
    ref.afterClosed().subscribe((tenant) => {
      if (tenant) {
        this.snackBar.open('Deployment created.', 'Dismiss', { duration: 6000 });
        this.fetch();
      }
    });
  }

  openRenameDialog(row: TenantListItemDto): void {
    const ref = this.dialog.open(RenameTenantDialogComponent, {
      width: '480px',
      data: { id: row.id, name: row.name, slug: row.slug, updatedAt: row.updated_at },
    });
    ref.afterClosed().subscribe((tenant) => {
      if (tenant) {
        this.snackBar.open('Deployment renamed.', 'Dismiss', { duration: 6000 });
        this.fetch();
      }
    });
  }

  pauseOrActivate(row: TenantListItemDto): void {
    const activating = row.status === 'paused';
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      data: activating
        ? {
            title: 'Activate deployment?',
            body: 'New conversations will be allowed.',
            confirmLabel: 'Activate deployment',
          }
        : {
            title: 'Pause deployment?',
            body: 'New conversations will be refused. In-progress sessions can finish. Agent Builder edits stay allowed.',
            confirmLabel: 'Pause deployment',
            destructive: true,
          },
    });

    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }
      const nextStatus: 'active' | 'paused' = activating ? 'active' : 'paused';
      this.deployments.changeStatus(row.id, { status: nextStatus }).subscribe({
        next: () => {
          this.snackBar.open(activating ? 'Deployment activated.' : 'Deployment paused.', 'Dismiss', {
            duration: 6000,
          });
          this.fetch();
        },
        error: (error: AppClientError) => {
          this.snackBar.open(error.message, 'Dismiss', { duration: 6000 });
        },
      });
    });
  }

  goToBuilder(row: TenantListItemDto): void {
    void this.router.navigate(['/tenants', row.id, 'builder']);
  }

  /** Deep link to Screen 4's per-tenant credential list (UX_GUIDELINES §9.1 nav entry point). */
  goToProviderCredentials(row: TenantListItemDto): void {
    void this.router.navigate(['/tenants', row.id, 'provider-credentials']);
  }

  /** Deep link to Screen 7's tenant-scoped Alerts & failover config (UX_GUIDELINES §16.4). */
  goToAlerts(row: TenantListItemDto): void {
    void this.router.navigate(['/tenants', row.id, 'alerts']);
  }

  /** Deep link to Screen 8's tenant-scoped Data residency settings (UX_GUIDELINES §17.4). */
  goToResidency(row: TenantListItemDto): void {
    void this.router.navigate(['/tenants', row.id, 'residency']);
  }

  /**
   * The caller-facing conversation link for this tenant (`/c/:slug`) — a
   * different SPA, not an in-app route, so this is a real `href` opened in
   * a new tab rather than a `Router.navigate` call.
   */
  conversationLink(row: TenantListItemDto): string {
    return `${this.conversationAppOrigin}/c/${row.slug}`;
  }

  private syncUrlAndFetch(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        q: this.searchControl.value.trim() || null,
        status: this.statusControl.value === 'all' ? null : this.statusControl.value,
        page: this.page(),
        page_size: this.pageSize(),
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.fetch();
  }

  private fetch(): void {
    this.loading.set(true);
    this.loadError.set(null);

    const status = this.statusControl.value === 'all' ? undefined : this.statusControl.value;

    this.deployments
      .list({
        q: this.searchControl.value.trim() || undefined,
        status,
        page: this.page(),
        page_size: this.pageSize(),
      })
      .subscribe({
        next: (response) => {
          this.items.set(response.items);
          this.total.set(response.total);
          this.loading.set(false);
        },
        error: (error: AppClientError) => {
          if (error.code === 'PAGE_SIZE_INVALID') {
            this.pageSize.set(DEFAULT_PAGE_SIZE);
            this.snackBar.open(error.message, 'Dismiss', { duration: 6000 });
            this.fetch();
            return;
          }
          this.loadError.set(error);
          this.loading.set(false);
        },
      });
  }
}
