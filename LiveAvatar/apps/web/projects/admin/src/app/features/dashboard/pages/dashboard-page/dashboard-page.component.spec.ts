import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { BreakpointObserver } from '@angular/cdk/layout';
import { DashboardPageComponent } from './dashboard-page.component';
import { DashboardService } from '../../services/dashboard.service';
import { TenantsApiService } from '@liveavatar/web-shared';

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    active_deployments: 2,
    sessions: { started: 10, ended: 6, failed: 2, abandoned: 1 },
    error_rate: 0.2,
    range: '24h',
    ...overrides,
  };
}

describe('DashboardPageComponent (Screen 1, FR-DASH-1/2)', () => {
  let fixture: ComponentFixture<DashboardPageComponent>;
  let dashboard: { summary: jest.Mock; providerHealth: jest.Mock };
  let router: { navigate: jest.Mock };
  // Drives BreakpointObserver.observe(...) so the phone-vs-desktop range
  // control (QA D-3) can be tested without depending on jsdom's fixed,
  // unconfigurable viewport size — same convention as shell.component.spec.ts.
  let breakpointMatches$: BehaviorSubject<{ matches: boolean }>;

  function setup(summaryResult: unknown = of(makeSummary()), healthResult: unknown = of({ categories: [] })) {
    dashboard = { summary: jest.fn().mockReturnValue(summaryResult), providerHealth: jest.fn().mockReturnValue(healthResult) };
    router = { navigate: jest.fn().mockResolvedValue(true) };
    breakpointMatches$ = new BehaviorSubject<{ matches: boolean }>({ matches: false }); // default: not phone-width

    TestBed.configureTestingModule({
      imports: [DashboardPageComponent, NoopAnimationsModule],
      providers: [
        { provide: DashboardService, useValue: dashboard },
        { provide: Router, useValue: router },
        { provide: TenantsApiService, useValue: { list: jest.fn().mockReturnValue(of({ items: [], total: 0, page: 1, page_size: 25 })) } },
        { provide: BreakpointObserver, useValue: { observe: () => breakpointMatches$ } },
      ],
    });
    fixture = TestBed.createComponent(DashboardPageComponent);
    fixture.detectChanges();
  }

  it('fetches summary and provider-health on init', () => {
    setup();
    expect(dashboard.summary).toHaveBeenCalledWith({ range: '24h', tenant_id: undefined });
    expect(dashboard.providerHealth).toHaveBeenCalled();
  });

  it('renders the widgets when data is present', () => {
    setup();
    expect(fixture.nativeElement.textContent).toContain('10 started');
  });

  it('shows a "—" error rate when zero sessions started (not 0% or NaN%)', () => {
    setup(of(makeSummary({ sessions: { started: 0, ended: 0, failed: 0, abandoned: 0 }, error_rate: 0 })));
    const component = fixture.componentInstance;
    expect(component.errorRateDisplay()).toBe('—');
  });

  it('shows the zero-tenants empty state when active_deployments is 0', () => {
    setup(of(makeSummary({ active_deployments: 0 })));
    expect(fixture.nativeElement.textContent).toContain('No deployments yet');
  });

  it('shows an error state and can retry the summary fetch independently', () => {
    setup(throwError(() => ({ code: 'RANGE_INVALID', message: 'boom' })));
    expect(fixture.nativeElement.textContent).toContain('Could not load the dashboard');
    dashboard.summary.mockReturnValue(of(makeSummary()));
    fixture.componentInstance.retrySummary();
    expect(dashboard.summary).toHaveBeenCalledTimes(2);
  });

  it('provider-health failure does not block the summary widgets from rendering', () => {
    setup(of(makeSummary()), throwError(() => ({ code: 'INTERNAL_ERROR', message: 'boom' })));
    expect(fixture.nativeElement.textContent).toContain('10 started');
    expect(fixture.nativeElement.textContent).toContain('Could not load provider health');
  });

  it('re-fetches summary only (not provider-health) on range change', () => {
    setup();
    dashboard.summary.mockClear();
    dashboard.providerHealth.mockClear();
    fixture.componentInstance.onRangeChange('7d');
    expect(dashboard.summary).toHaveBeenCalledWith({ range: '7d', tenant_id: undefined });
    expect(dashboard.providerHealth).not.toHaveBeenCalled();
  });

  it('re-fetches summary with the selected tenant_id', () => {
    setup();
    dashboard.summary.mockClear();
    fixture.componentInstance.onTenantChange('t1');
    expect(dashboard.summary).toHaveBeenCalledWith({ range: '24h', tenant_id: 't1' });
  });

  it('navigates to Provider Registry with the category on health-card click', () => {
    setup();
    fixture.componentInstance.goToProviderCategory('llm');
    expect(router.navigate).toHaveBeenCalledWith(['/providers'], { queryParams: { category: 'llm' } });
  });

  it('navigates to Deployments from the zero-tenants empty state', () => {
    setup();
    fixture.componentInstance.goToDeployments();
    expect(router.navigate).toHaveBeenCalledWith(['/deployments']);
  });

  it('maps every provider-health category to its real acronym/proper-noun label, not the raw enum key (QA D-1)', () => {
    setup();
    const component = fixture.componentInstance;
    expect(component.categoryLabel('transport')).toBe('LiveKit');
    expect(component.categoryLabel('stt')).toBe('STT');
    expect(component.categoryLabel('llm')).toBe('LLM');
    expect(component.categoryLabel('tts')).toBe('TTS');
    expect(component.categoryLabel('avatar')).toBe('Avatar');
    expect(component.categoryLabel('unknown-future-category')).toBe('unknown-future-category');
  });

  it('retries the provider-health fetch independently of the summary fetch', () => {
    setup();
    dashboard.providerHealth.mockClear();
    fixture.componentInstance.retryProviderHealth();
    expect(dashboard.providerHealth).toHaveBeenCalledTimes(1);
  });

  it('renders provider-health category cards using the mapped label (QA D-1)', () => {
    setup(of(makeSummary()), of({ categories: [{ category: 'stt', state: 'green' }] }));
    expect(fixture.nativeElement.textContent).toContain('STT');
    expect(fixture.nativeElement.textContent).not.toContain('Stt');
  });

  it('renders the button-toggle-group range control at desktop width (QA D-3)', () => {
    setup();
    expect(fixture.nativeElement.querySelector('mat-button-toggle-group')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('mat-select')).toBeNull();
  });

  it('renders a mat-select range control at phone width instead of the button-toggle-group (QA D-3)', () => {
    setup();
    breakpointMatches$.next({ matches: true });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('mat-select')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('mat-button-toggle-group')).toBeNull();
  });

  it('maps every provider-health state to a distinct icon+label', () => {
    setup();
    const component = fixture.componentInstance;
    expect(component.stateIcon('green')).toBe('check_circle');
    expect(component.stateIcon('amber')).toBe('warning');
    expect(component.stateIcon('red')).toBe('error');
    expect(component.stateIcon('gray')).toBe('help_outline');
    expect(component.stateLabel('green')).toBe('Healthy');
    expect(component.stateLabel('amber')).toBe('Degraded');
    expect(component.stateLabel('red')).toBe('Unreachable');
    expect(component.stateLabel('gray')).toBe('Unknown');
  });
});
