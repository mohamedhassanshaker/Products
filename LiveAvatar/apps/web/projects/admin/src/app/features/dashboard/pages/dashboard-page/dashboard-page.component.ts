import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { map } from 'rxjs';
import type { DashboardSummaryResponse, ProviderHealthResponse } from '@liveavatar/contracts';
import { EmptyStateComponent, PageHeaderComponent, TenantSelectComponent, type AppClientError } from '@liveavatar/web-shared';
import { DashboardService } from '../../services/dashboard.service';

type Range = '1h' | '24h' | '7d';

/**
 * QA fix (phase7-admin-spa D-3): UX_GUIDELINES §13.6 requires the phone
 * range control to become a `mat-select` (same phone convention as
 * Deployments' status filter, §1.4) rather than three cramped segmented
 * buttons crowding the header row against the viewport edge.
 */
const PHONE_BREAKPOINT = '(max-width: 599px)';

/** Dashboard — Screen 1 (FR-DASH-1/2, UX_GUIDELINES §13). */
@Component({
  selector: 'la-dashboard-page',
  standalone: true,
  imports: [
    PageHeaderComponent,
    EmptyStateComponent,
    TenantSelectComponent,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.scss',
})
export class DashboardPageComponent implements OnInit {
  private readonly dashboard = inject(DashboardService);
  private readonly router = inject(Router);
  private readonly breakpointObserver = inject(BreakpointObserver);

  /** QA fix (phase7-admin-spa D-3) — drives which range control renders. */
  protected readonly isPhone = toSignal(
    this.breakpointObserver.observe(PHONE_BREAKPOINT).pipe(map((state) => state.matches)),
    { initialValue: false },
  );

  readonly range = signal<Range>('24h');
  readonly tenantId = signal<string | null>(null);

  readonly summary = signal<DashboardSummaryResponse | null>(null);
  readonly summaryLoading = signal(true);
  readonly summaryError = signal<AppClientError | null>(null);

  readonly providerHealth = signal<ProviderHealthResponse | null>(null);
  readonly healthLoading = signal(true);
  readonly healthError = signal<AppClientError | null>(null);

  ngOnInit(): void {
    this.fetchSummary();
    this.fetchProviderHealth();
  }

  onRangeChange(range: Range): void {
    this.range.set(range);
    this.fetchSummary();
  }

  onTenantChange(tenantId: string | null): void {
    this.tenantId.set(tenantId);
    this.fetchSummary();
  }

  retrySummary(): void {
    this.fetchSummary();
  }

  retryProviderHealth(): void {
    this.fetchProviderHealth();
  }

  /** UX_GUIDELINES §13.1 step 6 — jump to the category's group header on Provider Registry. */
  goToProviderCategory(category: string): void {
    void this.router.navigate(['/providers'], { queryParams: { category } });
  }

  /** UX_GUIDELINES §13.2 — the zero-tenant empty-state's secondary action. */
  goToDeployments(): void {
    void this.router.navigate(['/deployments']);
  }

  /** Icon + text per baseline (UX_GUIDELINES §13.2) — status is never colour alone. */
  stateIcon(state: string): string {
    switch (state) {
      case 'green':
        return 'check_circle';
      case 'amber':
        return 'warning';
      case 'red':
        return 'error';
      default:
        return 'help_outline';
    }
  }

  /**
   * QA fix (phase7-admin-spa D-1): UX_GUIDELINES §13.1's provider-health
   * grid must read "LiveKit, STT, TTS, Avatar, LLM" — the template
   * previously interpolated the raw lowercase category key with a
   * `text-transform: capitalize` CSS rule, which only capitalizes the
   * first letter ("Stt"/"Llm"/"Tts") instead of rendering the real
   * acronym/proper-noun form.
   */
  categoryLabel(category: string): string {
    switch (category) {
      case 'transport':
        return 'LiveKit';
      case 'stt':
        return 'STT';
      case 'llm':
        return 'LLM';
      case 'tts':
        return 'TTS';
      case 'avatar':
        return 'Avatar';
      default:
        return category;
    }
  }

  stateLabel(state: string): string {
    switch (state) {
      case 'green':
        return 'Healthy';
      case 'amber':
        return 'Degraded';
      case 'red':
        return 'Unreachable';
      default:
        return 'Unknown';
    }
  }

  errorRateDisplay(): string {
    const summary = this.summary();
    if (!summary || summary.sessions.started === 0) {
      return '—';
    }
    return `${Math.round(summary.error_rate * 100)}%`;
  }

  private fetchSummary(): void {
    this.summaryLoading.set(true);
    this.summaryError.set(null);
    this.dashboard.summary({ range: this.range(), tenant_id: this.tenantId() ?? undefined }).subscribe({
      next: (result) => {
        this.summary.set(result);
        this.summaryLoading.set(false);
      },
      error: (error: AppClientError) => {
        this.summaryError.set(error);
        this.summaryLoading.set(false);
      },
    });
  }

  private fetchProviderHealth(): void {
    this.healthLoading.set(true);
    this.healthError.set(null);
    this.dashboard.providerHealth().subscribe({
      next: (result) => {
        this.providerHealth.set(result);
        this.healthLoading.set(false);
      },
      error: (error: AppClientError) => {
        this.healthError.set(error);
        this.healthLoading.set(false);
      },
    });
  }
}
