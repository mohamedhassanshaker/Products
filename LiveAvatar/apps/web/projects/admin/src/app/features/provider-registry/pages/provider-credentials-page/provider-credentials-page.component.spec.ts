import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { TenantsApiService } from '@liveavatar/web-shared';
import { ProviderCredentialsPageComponent } from './provider-credentials-page.component';
import { ProviderRegistryService } from '../../services/provider-registry.service';

function credential(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cred-1',
    tenant_id: 't-1',
    provider_key: 'openai',
    display_label: 'default',
    endpoint_url: 'https://api.openai.com',
    credential_ref: 'secrets/openai',
    has_secret: true,
    extra: {},
    last_probe_status: 'unknown' as const,
    last_probe_at: null,
    last_probe_error: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ProviderCredentialsPageComponent', () => {
  let fixture: ComponentFixture<ProviderCredentialsPageComponent>;
  let component: ProviderCredentialsPageComponent;
  let registry: {
    listDefinitions: jest.Mock;
    listCredentials: jest.Mock;
    deleteCredential: jest.Mock;
    probeCredential: jest.Mock;
  };
  let tenantsApi: { get: jest.Mock };
  let dialog: { open: jest.Mock };
  let snackBar: { open: jest.Mock };

  async function setup(items = [credential()]) {
    registry = {
      listDefinitions: jest.fn(() => of({ items: [] })),
      listCredentials: jest.fn(() => of({ items })),
      deleteCredential: jest.fn(),
      probeCredential: jest.fn(),
    };
    tenantsApi = { get: jest.fn(() => of({ id: 't-1', name: 'Acme' })) };
    dialog = { open: jest.fn() };
    snackBar = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [ProviderCredentialsPageComponent, NoopAnimationsModule],
      providers: [
        { provide: ProviderRegistryService, useValue: registry },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't-1' }) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProviderCredentialsPageComponent);
    component = fixture.componentInstance;
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  }

  it('loads credentials for the route tenant id', async () => {
    await setup();
    expect(registry.listCredentials).toHaveBeenCalledWith('t-1');
    expect(component.items()).toHaveLength(1);
  });

  it('shows the empty state with zero credentials', async () => {
    await setup([]);
    expect(component.items()).toHaveLength(0);
  });

  it('probes a credential and updates its row in place', async () => {
    await setup();
    registry.probeCredential.mockReturnValue(of({ status: 'healthy', probed_at: '2026-01-02T00:00:00.000Z' }));
    component.probe(credential());
    expect(component.items()[0].last_probe_status).toBe('healthy');
    expect(component.probingId()).toBeNull();
  });

  it('snackbars a rate-limit message on 429 without crashing', async () => {
    await setup();
    registry.probeCredential.mockReturnValue(
      throwError(() => ({ code: 'PROVIDER_PROBE_RATE_LIMITED', message: 'x', status: 429, details: {} })),
    );
    component.probe(credential());
    expect(snackBar.open).toHaveBeenCalledWith('Too many connection tests. Try again in a minute.', 'Dismiss', expect.any(Object));
  });

  it('deletes a credential after confirm', async () => {
    await setup();
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    registry.deleteCredential.mockReturnValue(of(undefined));
    component.deleteCredential(credential());
    expect(registry.deleteCredential).toHaveBeenCalledWith('t-1', 'cred-1');
  });

  it('surfaces a blocked-delete message with an actionable snackbar on 422', async () => {
    await setup();
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    registry.deleteCredential.mockReturnValue(
      throwError(() => ({ code: 'CONFIG_CREDENTIAL_MISSING', message: 'x', status: 422, details: {} })),
    );
    component.deleteCredential(credential());
    expect(snackBar.open).toHaveBeenCalledWith(expect.stringContaining("can't be deleted"), 'Open Agent Builder', expect.any(Object));
  });

  it('redirects to Deployments on TENANT_NOT_FOUND', async () => {
    tenantsApi = { get: jest.fn(() => throwError(() => ({ code: 'TENANT_NOT_FOUND', message: 'x', status: 404, details: {} }))) };
    registry = {
      listDefinitions: jest.fn(() => of({ items: [] })),
      listCredentials: jest.fn(() => of({ items: [] })),
      deleteCredential: jest.fn(),
      probeCredential: jest.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [ProviderCredentialsPageComponent, NoopAnimationsModule],
      providers: [
        { provide: ProviderRegistryService, useValue: registry },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: MatDialog, useValue: { open: jest.fn() } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't-1' }) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProviderCredentialsPageComponent);
    const router = TestBed.inject(Router);
    const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
    expect(navigateSpy).toHaveBeenCalledWith(['/deployments']);
  });
});
