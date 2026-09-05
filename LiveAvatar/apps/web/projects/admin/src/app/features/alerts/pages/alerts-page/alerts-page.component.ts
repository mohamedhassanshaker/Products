import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { AlertEventDto, AlertPolicyResponse, FailoverStatsResponse } from '@liveavatar/contracts';
import { EmptyStateComponent, PageHeaderComponent, TenantsApiService, type AppClientError } from '@liveavatar/web-shared';
import { AlertsService } from '../../services/alerts.service';

const DEFAULT_BACKOFF = 200;

/**
 * Alerts & failover — Screen 7 real screen (`/admin/tenants/:id/alerts`,
 * FR-ALERT-1..4, UX_GUIDELINES §16.2). Fallback LLM *identity* is read-only
 * here per the pre-existing Agent Builder §10.5 ownership decision — this
 * screen edits only retry policy + degraded message, and displays (never
 * edits) the last-24h failover stats and the 7-day alert event list.
 */
@Component({
  selector: 'la-alerts-page',
  standalone: true,
  imports: [PageHeaderComponent, EmptyStateComponent, RouterLink, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './alerts-page.component.html',
  styleUrl: './alerts-page.component.scss',
})
export class AlertsPageComponent implements OnInit {
  private readonly alerts = inject(AlertsService);
  private readonly tenants = inject(TenantsApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  /** Not private: the template's "Edit in Agent Builder" link (D-4 fix) needs it to build the route. */
  protected readonly tenantId = this.route.snapshot.paramMap.get('id') ?? '';

  readonly tenantName = signal('');
  readonly tenantNotFound = signal(false);

  readonly policy = signal<AlertPolicyResponse | null>(null);
  readonly policyLoading = signal(true);

  readonly retryMaxAttempts = signal(3);
  readonly retryBackoffMs = signal<number[]>([200, 400, 800]);
  readonly degradedModeMessage = signal('');

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly stats = signal<FailoverStatsResponse | null>(null);
  readonly statsError = signal<AppClientError | null>(null);

  readonly alertEvents = signal<AlertEventDto[]>([]);
  readonly alertsLoading = signal(true);
  readonly alertsError = signal<AppClientError | null>(null);

  readonly activeTab = signal<'retry' | 'alerts'>('retry');

  /**
   * QA fix (phase7-admin-spa D-4): UX_GUIDELINES §16.2 step 4 requires a
   * read-only "Fallback LLM" display (`llm_fallback.provider` +
   * `.model`, or "No fallback configured" if `null`) plus an "Edit in
   * Agent Builder" link — this screen never edits fallback identity
   * itself (§10.5's pre-existing ownership decision), it only surfaces
   * what Agent Builder already configured.
   */
  readonly fallbackLlmDisplay = computed(() => {
    const fallback = this.policy()?.llm_fallback;
    return fallback ? `${fallback.provider} / ${fallback.model}` : 'No fallback configured';
  });

  /**
   * QA fix (phase7-admin-spa D-5): UX_GUIDELINES §16.2 step 5 maps each
   * alert event type to an icon + human-readable label instead of the raw
   * snake_case enum value.
   */
  private static readonly EVENT_TYPE_DISPLAY: Record<string, { icon: string; label: string }> = {
    llm_failover: { icon: 'sync_problem', label: 'LLM failover' },
    provider_unreachable: { icon: 'cloud_off', label: 'Provider unreachable' },
    session_failed: { icon: 'report', label: 'Session failed' },
    gpu_unhealthy: { icon: 'dns', label: 'GPU unhealthy' },
    // Phase 15 (BL-059) — fired by a Handoff graph node ("transfer to a
    // human," intent only in v1). Same icon as the Reasoning tab's
    // `handoff` node type (`nodeTypeIcon`) for recognition consistency.
    handoff_requested: { icon: 'support_agent', label: 'Handoff requested' },
  };

  eventTypeIcon(type: string): string {
    return AlertsPageComponent.EVENT_TYPE_DISPLAY[type]?.icon ?? 'notifications';
  }

  eventTypeLabel(type: string): string {
    return AlertsPageComponent.EVENT_TYPE_DISPLAY[type]?.label ?? type;
  }

  ngOnInit(): void {
    this.tenants.get(this.tenantId).subscribe({
      next: (tenant) => this.tenantName.set(tenant.name),
      error: () => {
        this.tenantNotFound.set(true);
        this.snackBar.open('Tenant not found.', 'Dismiss', { duration: 6000 });
      },
    });
    this.fetchPolicy();
    this.fetchStats();
    this.fetchAlerts();
  }

  selectTab(tab: 'retry' | 'alerts'): void {
    this.activeTab.set(tab);
  }

  onMaxAttemptsChange(value: number): void {
    const clamped = Math.min(5, Math.max(1, value));
    this.retryMaxAttempts.set(clamped);
    const current = this.retryBackoffMs();
    if (current.length < clamped) {
      const last = current[current.length - 1] ?? DEFAULT_BACKOFF;
      this.retryBackoffMs.set([...current, ...Array(clamped - current.length).fill(last)]);
    } else if (current.length > clamped) {
      this.retryBackoffMs.set(current.slice(0, clamped));
    }
  }

  onBackoffChange(index: number, value: number): void {
    const next = [...this.retryBackoffMs()];
    next[index] = value;
    this.retryBackoffMs.set(next);
  }

  onMessageChange(value: string): void {
    this.degradedModeMessage.set(value.slice(0, 500));
  }

  save(): void {
    const policy = this.policy();
    if (!policy || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);
    this.alerts
      .updatePolicy(
        this.tenantId,
        {
          retry_max_attempts: this.retryMaxAttempts(),
          retry_backoff_ms: this.retryBackoffMs(),
          degraded_mode_message: this.degradedModeMessage(),
        },
        policy.updated_at,
      )
      .subscribe({
        next: (updated) => {
          this.policy.set(updated);
          this.saving.set(false);
          this.snackBar.open('Alert policy saved.', 'Dismiss', { duration: 6000 });
        },
        error: (error: AppClientError) => {
          this.saving.set(false);
          this.saveError.set(error.message);
        },
      });
  }

  backToDeployments(): void {
    void this.router.navigate(['/deployments']);
  }

  private fetchPolicy(): void {
    this.policyLoading.set(true);
    this.alerts.getPolicy(this.tenantId).subscribe({
      next: (policy) => {
        this.policy.set(policy);
        this.retryMaxAttempts.set(policy.retry_max_attempts);
        this.retryBackoffMs.set(policy.retry_backoff_ms);
        this.degradedModeMessage.set(policy.degraded_mode_message);
        this.policyLoading.set(false);
      },
      error: () => {
        this.policyLoading.set(false);
      },
    });
  }

  private fetchStats(): void {
    this.alerts.failoverStats(this.tenantId, { range: '24h' }).subscribe({
      next: (stats) => this.stats.set(stats),
      error: (error: AppClientError) => this.statsError.set(error),
    });
  }

  private fetchAlerts(): void {
    this.alertsLoading.set(true);
    this.alerts.listAlerts(this.tenantId).subscribe({
      next: (response) => {
        this.alertEvents.set(response.items);
        this.alertsLoading.set(false);
      },
      error: (error: AppClientError) => {
        this.alertsError.set(error);
        this.alertsLoading.set(false);
      },
    });
  }
}
