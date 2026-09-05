import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AlertsPageComponent } from './alerts-page.component';
import { AlertsService } from '../../services/alerts.service';
import { TenantsApiService } from '@liveavatar/web-shared';

function makePolicy(overrides: Record<string, unknown> = {}) {
  return {
    retry_max_attempts: 3,
    retry_backoff_ms: [200, 400, 800],
    degraded_mode_message: 'Please wait.',
    llm_fallback: null,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('AlertsPageComponent (Screen 7, FR-ALERT-1..4)', () => {
  let fixture: ComponentFixture<AlertsPageComponent>;
  let alerts: { getPolicy: jest.Mock; updatePolicy: jest.Mock; failoverStats: jest.Mock; listAlerts: jest.Mock };
  let tenantsApi: { get: jest.Mock };
  let snackBar: { open: jest.Mock };

  // QA fix (phase7-admin-spa D-4): the template now includes a real
  // `routerLink` ("Edit in Agent Builder"), which needs a real `Router`
  // instance to resolve `createUrlTree`/navigation-event subscriptions —
  // same convention as `deployments-list-page.component.spec.ts`: let
  // Angular provide its own `Router` via `RouterTestingModule`-equivalent
  // defaults and just spy on `navigate`, rather than hand-mocking the
  // whole `Router` API surface.
  function setup(overrides: {
    alertsOverrides?: Partial<typeof alerts>;
    tenantsOverride?: unknown;
  } = {}) {
    alerts = {
      getPolicy: jest.fn().mockReturnValue(of(makePolicy())),
      updatePolicy: jest.fn().mockReturnValue(of(makePolicy({ degraded_mode_message: 'Updated.' }))),
      failoverStats: jest.fn().mockReturnValue(of({ primary_failures: 1, fallback_successes: 1, degraded_invocations: 0 })),
      listAlerts: jest.fn().mockReturnValue(of({ items: [], total: 0 })),
      ...overrides.alertsOverrides,
    };
    tenantsApi = {
      get: jest.fn().mockReturnValue(overrides.tenantsOverride ?? of({ id: 't1', name: 'Acme' })),
    };
    snackBar = { open: jest.fn() };

    TestBed.configureTestingModule({
      imports: [AlertsPageComponent, NoopAnimationsModule],
      providers: [
        { provide: AlertsService, useValue: alerts },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't1' }) } } },
      ],
    });
    fixture = TestBed.createComponent(AlertsPageComponent);
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  }

  it('fetches tenant name, policy, stats, and alerts on init', () => {
    setup();
    expect(tenantsApi.get).toHaveBeenCalledWith('t1');
    expect(alerts.getPolicy).toHaveBeenCalledWith('t1');
    expect(alerts.failoverStats).toHaveBeenCalledWith('t1', { range: '24h' });
    expect(alerts.listAlerts).toHaveBeenCalledWith('t1');
  });

  it('prefills the retry form from the loaded policy', () => {
    setup();
    expect(fixture.componentInstance.retryMaxAttempts()).toBe(3);
    expect(fixture.componentInstance.retryBackoffMs()).toEqual([200, 400, 800]);
  });

  it('growing max_attempts extends the backoff array, defaulted to the last entry', () => {
    setup();
    fixture.componentInstance.onMaxAttemptsChange(5);
    expect(fixture.componentInstance.retryBackoffMs()).toEqual([200, 400, 800, 800, 800]);
  });

  it('shrinking max_attempts truncates the trailing entries without discarding the rest', () => {
    setup();
    fixture.componentInstance.onMaxAttemptsChange(1);
    expect(fixture.componentInstance.retryBackoffMs()).toEqual([200]);
  });

  it('saves the retry policy with the current updated_at as If-Match', () => {
    setup();
    fixture.componentInstance.save();
    expect(alerts.updatePolicy).toHaveBeenCalledWith(
      't1',
      { retry_max_attempts: 3, retry_backoff_ms: [200, 400, 800], degraded_mode_message: 'Please wait.' },
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('shows a save error inline on failure', () => {
    setup();
    alerts.updatePolicy.mockReturnValue(throwError(() => ({ code: 'CONFIG_RETRY_INVALID', message: 'Bad retry.' })));
    fixture.componentInstance.save();
    expect(fixture.componentInstance.saveError()).toBe('Bad retry.');
  });

  it('stops the loading spinner even when the policy fetch fails', () => {
    setup({ alertsOverrides: { getPolicy: jest.fn().mockReturnValue(throwError(() => ({ code: 'INTERNAL_ERROR', message: 'boom' }))) } });
    expect(fixture.componentInstance.policyLoading()).toBe(false);
  });

  it('shows the tenant-not-found empty state and a snackbar on 404', () => {
    setup({ tenantsOverride: throwError(() => ({ code: 'TENANT_NOT_FOUND', message: 'Tenant not found.' })) });
    expect(fixture.nativeElement.textContent).toContain('Tenant not found.');
    expect(snackBar.open).toHaveBeenCalled();
  });

  it('shows the empty alerts state as good news, not an error', () => {
    setup();
    fixture.componentInstance.selectTab('alerts');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No alerts in the last 7 days.');
  });

  it('onBackoffChange updates a single attempt delay', () => {
    setup();
    fixture.componentInstance.onBackoffChange(1, 999);
    expect(fixture.componentInstance.retryBackoffMs()).toEqual([200, 999, 800]);
  });

  it('onMessageChange caps the degraded message at 500 chars', () => {
    setup();
    fixture.componentInstance.onMessageChange('x'.repeat(600));
    expect(fixture.componentInstance.degradedModeMessage().length).toBe(500);
  });

  it('save is a no-op when already saving or no policy is loaded yet', () => {
    setup();
    fixture.componentInstance.policyLoading.set(true);
    (fixture.componentInstance as unknown as { saving: { set(v: boolean): void } }).saving.set(true);
    fixture.componentInstance.save();
    expect(alerts.updatePolicy).not.toHaveBeenCalled();
  });

  it('records a stats-fetch error without blocking the rest of the page', () => {
    setup({
      alertsOverrides: {
        failoverStats: jest.fn().mockReturnValue(throwError(() => ({ code: 'INTERNAL_ERROR', message: 'boom' }))),
      },
    });
    expect(fixture.componentInstance.statsError()).toBeTruthy();
  });

  it('records an alerts-list fetch error', () => {
    setup({
      alertsOverrides: {
        listAlerts: jest.fn().mockReturnValue(throwError(() => ({ code: 'INTERNAL_ERROR', message: 'boom' }))),
      },
    });
    fixture.componentInstance.selectTab('alerts');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Could not load alerts');
  });

  it('navigates back to deployments', () => {
    setup();
    fixture.componentInstance.backToDeployments();
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/deployments']);
  });

  it('shows "No fallback configured" when llm_fallback is null, plus an Edit in Agent Builder link (QA D-4)', () => {
    setup();
    expect(fixture.nativeElement.textContent).toContain('No fallback configured');
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('a[href*="/builder"]');
    expect(link).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Edit in Agent Builder');
  });

  it('renders the configured fallback LLM provider/model read-only (QA D-4)', () => {
    setup({
      alertsOverrides: {
        getPolicy: jest.fn().mockReturnValue(
          of(makePolicy({ llm_fallback: { provider: 'anthropic', model: 'claude-3-5-sonnet' } })),
        ),
      },
    });
    expect(fixture.nativeElement.textContent).toContain('anthropic / claude-3-5-sonnet');
  });

  it('falls back to the raw type/a generic icon for an unmapped alert event type (QA D-5)', () => {
    setup();
    const component = fixture.componentInstance;
    expect(component.eventTypeIcon('some_future_type')).toBe('notifications');
    expect(component.eventTypeLabel('some_future_type')).toBe('some_future_type');
  });

  it('maps alert event types to a human label, not the raw snake_case value (QA D-5)', () => {
    setup({
      alertsOverrides: {
        listAlerts: jest.fn().mockReturnValue(
          of({ items: [{ id: 'a1', type: 'llm_failover', message: 'Failover to anthropic.', created_at: '2026-01-01T00:00:00.000Z' }], total: 1 }),
        ),
      },
    });
    fixture.componentInstance.selectTab('alerts');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('LLM failover');
    expect(fixture.nativeElement.textContent).not.toContain('llm_failover');
  });

  it('maps handoff_requested to a human label and icon (Phase 15, BL-059)', () => {
    setup();
    const component = fixture.componentInstance;
    expect(component.eventTypeIcon('handoff_requested')).toBe('support_agent');
    expect(component.eventTypeLabel('handoff_requested')).toBe('Handoff requested');
  });
});
