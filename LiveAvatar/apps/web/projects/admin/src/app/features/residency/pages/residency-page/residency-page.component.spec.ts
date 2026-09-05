import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ResidencyPageComponent } from './residency-page.component';
import { ResidencyService } from '../../services/residency.service';
import { TenantsApiService } from '@liveavatar/web-shared';

function makePolicy(overrides: Record<string, unknown> = {}) {
  return {
    send_to_remote_llm: 'prompt_text_only',
    retain_transcripts_days: 90,
    recordings_enabled: false,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ResidencyPageComponent (Screen 8, FR-PRIV-1/2)', () => {
  let fixture: ComponentFixture<ResidencyPageComponent>;
  let residency: { get: jest.Mock; update: jest.Mock };
  let tenantsApi: { get: jest.Mock };
  let router: { navigate: jest.Mock };
  let snackBar: { open: jest.Mock };

  function setup() {
    residency = {
      get: jest.fn().mockReturnValue(of(makePolicy())),
      update: jest.fn().mockReturnValue(of({ ...makePolicy(), warnings: [] })),
    };
    tenantsApi = { get: jest.fn().mockReturnValue(of({ id: 't1', name: 'Acme' })) };
    router = { navigate: jest.fn().mockResolvedValue(true) };
    snackBar = { open: jest.fn() };

    TestBed.configureTestingModule({
      imports: [ResidencyPageComponent],
      providers: [
        { provide: ResidencyService, useValue: residency },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: Router, useValue: router },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't1' }) } } },
      ],
    });
    fixture = TestBed.createComponent(ResidencyPageComponent);
    fixture.detectChanges();
  }

  it('fetches tenant name and residency policy on init', () => {
    setup();
    expect(tenantsApi.get).toHaveBeenCalledWith('t1');
    expect(residency.get).toHaveBeenCalledWith('t1');
  });

  it('prefills the form from the loaded policy', () => {
    setup();
    expect(fixture.componentInstance.sendToRemoteLlm()).toBe('prompt_text_only');
    expect(fixture.componentInstance.retainTranscriptsDays()).toBe(90);
  });

  it('shows the recordings warning the instant the toggle turns on, before save', () => {
    setup();
    fixture.componentInstance.onRecordingsToggle(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Recordings are enabled but capture is not implemented in v1');
  });

  it('hides the warning again once toggled back off', () => {
    setup();
    fixture.componentInstance.onRecordingsToggle(true);
    fixture.componentInstance.onRecordingsToggle(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('nothing will be stored');
  });

  it('saves with the current updated_at as If-Match', () => {
    setup();
    fixture.componentInstance.onModeChange('none');
    fixture.componentInstance.save();
    expect(residency.update).toHaveBeenCalledWith(
      't1',
      { send_to_remote_llm: 'none', retain_transcripts_days: 90, recordings_enabled: false },
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('shows a form-level error on CONFIG_RESIDENCY_BLOCKS_LLM, without resetting the chosen value', () => {
    setup();
    residency.update.mockReturnValue(
      throwError(() => ({
        code: 'CONFIG_RESIDENCY_BLOCKS_LLM',
        message: "Residency policy 'none' cannot be used with a remote LLM. Choose prompt_text_only or an on-prem LLM (not available in v1).",
      })),
    );
    fixture.componentInstance.onModeChange('none');
    fixture.componentInstance.save();
    expect(fixture.componentInstance.saveError()).toContain('cannot be used with a remote LLM');
    expect(fixture.componentInstance.sendToRemoteLlm()).toBe('none');
  });

  it('shows the tenant-not-found state on a 404', () => {
    tenantsApi = { get: jest.fn().mockReturnValue(throwError(() => ({ code: 'TENANT_NOT_FOUND', message: 'Tenant not found.' }))) };
    residency = { get: jest.fn().mockReturnValue(of(makePolicy())), update: jest.fn() };
    router = { navigate: jest.fn().mockResolvedValue(true) };
    snackBar = { open: jest.fn() };
    TestBed.configureTestingModule({
      imports: [ResidencyPageComponent],
      providers: [
        { provide: ResidencyService, useValue: residency },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: Router, useValue: router },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't1' }) } } },
      ],
    });
    fixture = TestBed.createComponent(ResidencyPageComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Tenant not found.');
  });

  it('onRetentionChange updates the retention days signal', () => {
    setup();
    fixture.componentInstance.onRetentionChange(180);
    expect(fixture.componentInstance.retainTranscriptsDays()).toBe(180);
  });

  it('save is a no-op while already saving', () => {
    setup();
    (fixture.componentInstance as unknown as { saving: { set(v: boolean): void } }).saving.set(true);
    fixture.componentInstance.save();
    expect(residency.update).not.toHaveBeenCalled();
  });

  it('a fetch error still resolves loading to false without crashing', () => {
    residency = { get: jest.fn().mockReturnValue(throwError(() => ({ code: 'INTERNAL_ERROR', message: 'boom' }))), update: jest.fn() };
    tenantsApi = { get: jest.fn().mockReturnValue(of({ id: 't1', name: 'Acme' })) };
    router = { navigate: jest.fn().mockResolvedValue(true) };
    snackBar = { open: jest.fn() };
    TestBed.configureTestingModule({
      imports: [ResidencyPageComponent],
      providers: [
        { provide: ResidencyService, useValue: residency },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: Router, useValue: router },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't1' }) } } },
      ],
    });
    fixture = TestBed.createComponent(ResidencyPageComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it('navigates back to deployments', () => {
    setup();
    fixture.componentInstance.backToDeployments();
    expect(router.navigate).toHaveBeenCalledWith(['/deployments']);
  });
});
