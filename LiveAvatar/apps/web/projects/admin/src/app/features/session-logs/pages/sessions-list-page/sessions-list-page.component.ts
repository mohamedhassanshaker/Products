import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import type { SessionListItemDto } from '@liveavatar/contracts';
import { EmptyStateComponent, PageHeaderComponent, StatusChipComponent, TenantSelectComponent, formatRelativeTime, type AppClientError } from '@liveavatar/web-shared';
import { AuthStore } from '../../../../core/auth/auth.store';
import { SessionLogsService } from '../../services/session-logs.service';

/** Session status values (LLD §8.1's status machine) — mirrors the wire enum. */
type SessionStatus = 'pending' | 'active' | 'ended' | 'failed' | 'abandoned' | 'degraded';

type StatusFilter = 'all' | SessionStatus;

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

/** Session logs — Screen 5 list (FR-SESS-1, UX_GUIDELINES §14). */
@Component({
  selector: 'la-sessions-list-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    PageHeaderComponent,
    EmptyStateComponent,
    StatusChipComponent,
    TenantSelectComponent,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTableModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sessions-list-page.component.html',
  styleUrl: './sessions-list-page.component.scss',
})
export class SessionsListPageComponent implements OnInit {
  private readonly sessions = inject(SessionLogsService);
  private readonly router = inject(Router);
  readonly authStore = inject(AuthStore);

  readonly displayedColumns = ['id', 'tenant', 'started', 'duration', 'status', 'providerStack', 'errorCode'];
  readonly pageSizeOptions = PAGE_SIZE_OPTIONS;

  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly statusControl = new FormControl<StatusFilter>('all', { nonNullable: true });

  readonly tenantId = signal<string | null>(null);
  readonly items = signal<SessionListItemDto[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly pageSize = signal<number>(DEFAULT_PAGE_SIZE);
  readonly loading = signal(false);
  readonly loadError = signal<AppClientError | null>(null);
  /** True once the first fetch for the current tenant scope has been attempted. */
  private readonly hasFetchedOnce = signal(false);

  /** FR-SESS-1: `tenant_id` is required for `admin`, optional for `operator`. */
  needsTenantChoice(): boolean {
    return !this.authStore.isOperator() && !this.tenantId();
  }

  hasActiveFilters(): boolean {
    return this.searchControl.value.trim().length > 0 || this.statusControl.value !== 'all';
  }

  ngOnInit(): void {
    this.searchControl.valueChanges.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => {
      this.page.set(1);
      this.fetch();
    });
    this.statusControl.valueChanges.subscribe(() => {
      this.page.set(1);
      this.fetch();
    });

    if (this.authStore.isOperator()) {
      this.fetch();
    }
  }

  onTenantChange(tenantId: string | null): void {
    this.tenantId.set(tenantId);
    this.page.set(1);
    this.fetch();
  }

  onPageEvent(event: PageEvent): void {
    this.page.set(event.pageIndex + 1);
    this.pageSize.set(event.pageSize);
    this.fetch();
  }

  clearFilters(): void {
    this.searchControl.setValue('', { emitEvent: false });
    this.statusControl.setValue('all', { emitEvent: false });
    this.page.set(1);
    this.fetch();
  }

  retry(): void {
    this.fetch();
  }

  relativeTime(iso: string): string {
    return formatRelativeTime(iso);
  }

  duration(ms: number | null): string {
    if (ms === null) {
      return '—';
    }
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
  }

  openDetail(row: SessionListItemDto): void {
    void this.router.navigate(['sessions', row.id]);
  }

  /**
   * QA fix (phase7-admin-spa D-7): renders the full provider-stack snapshot
   * (transport/stt/llm/tts/avatar) as a compact, order-preserving list of
   * whichever categories are actually populated, per UX_GUIDELINES §14.1
   * step 5 — previously only `provider_stack.llm` was ever read, silently
   * discarding the other four categories even when the snapshot had them.
   * `llm_fallback` is intentionally excluded — it's not one of the five
   * "stack" categories this column documents, and is already shown
   * elsewhere for the tenant (Alerts screen, §16.2).
   */
  providerStackSummary(stack: SessionListItemDto['provider_stack']): string {
    const parts = [stack.transport, stack.stt, stack.llm, stack.tts, stack.avatar].filter(
      (value): value is string => Boolean(value),
    );
    return parts.length > 0 ? parts.join(' · ') : '—';
  }

  private fetch(): void {
    if (this.needsTenantChoice()) {
      return;
    }
    this.hasFetchedOnce.set(true);
    this.loading.set(true);
    this.loadError.set(null);

    const status = this.statusControl.value === 'all' ? undefined : this.statusControl.value;

    this.sessions
      .list({
        tenant_id: this.tenantId() ?? undefined,
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
          this.loadError.set(error);
          this.loading.set(false);
        },
      });
  }
}
