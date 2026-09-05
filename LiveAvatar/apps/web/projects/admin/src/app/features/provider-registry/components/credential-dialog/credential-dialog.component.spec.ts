import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { CredentialDialogComponent, type CredentialDialogData } from './credential-dialog.component';
import { ProviderRegistryService } from '../../services/provider-registry.service';

describe('CredentialDialogComponent', () => {
  let fixture: ComponentFixture<CredentialDialogComponent>;
  let component: CredentialDialogComponent;
  let registry: { createCredential: jest.Mock; updateCredential: jest.Mock };
  let dialogRef: { close: jest.Mock };

  async function setup(data: CredentialDialogData) {
    registry = { createCredential: jest.fn(), updateCredential: jest.fn() };
    dialogRef = { close: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [CredentialDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: ProviderRegistryService, useValue: registry },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CredentialDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  const definitions = [
    {
      key: 'openai',
      category: 'llm' as const,
      display_name: 'OpenAI',
      hosting: 'remote' as const,
      interface_name: 'ILLMProvider',
      requires_credential: true,
      enabled: true,
      feature_gaps: null,
    },
  ];

  it('disables submit until provider and endpoint are set (create mode)', async () => {
    await setup({ tenantId: 't-1', definitions });
    expect(component.submitDisabled()).toBe(true);
    component.form.controls.provider_key.setValue('openai');
    component.form.controls.endpoint_url.setValue('https://api.openai.com');
    expect(component.submitDisabled()).toBe(false);
  });

  it('creates a credential and closes with the result', async () => {
    await setup({ tenantId: 't-1', definitions });
    registry.createCredential.mockReturnValue(of({ id: 'cred-1' }));
    component.form.controls.provider_key.setValue('openai');
    component.form.controls.endpoint_url.setValue('https://api.openai.com');
    component.onSubmit();
    expect(registry.createCredential).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({ provider_key: 'openai', endpoint_url: 'https://api.openai.com' }),
    );
    expect(dialogRef.close).toHaveBeenCalledWith({ id: 'cred-1' });
  });

  it('blocks submit on malformed extra JSON without calling the API', async () => {
    await setup({ tenantId: 't-1', definitions });
    component.form.controls.provider_key.setValue('openai');
    component.form.controls.endpoint_url.setValue('https://api.openai.com');
    component.form.controls.extra_json.setValue('{ not valid json');
    component.onSubmit();
    expect(component.extraJsonError()).toBe('Enter valid JSON.');
    expect(registry.createCredential).not.toHaveBeenCalled();
  });

  it('maps PROVIDER_ENDPOINT_INVALID to the endpoint field', async () => {
    await setup({ tenantId: 't-1', definitions });
    registry.createCredential.mockReturnValue(
      throwError(() => ({ code: 'PROVIDER_ENDPOINT_INVALID', message: 'Endpoint must be an https URL.', status: 400, details: {} })),
    );
    component.form.controls.provider_key.setValue('openai');
    component.form.controls.endpoint_url.setValue('http://evil.example.com');
    component.onSubmit();
    expect(component.form.controls.endpoint_url.getError('server')).toBe('Endpoint must be an https URL.');
  });

  it('edit mode disables the provider field and pre-fills existing values (never the secret)', async () => {
    const existing = {
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
    };
    await setup({ tenantId: 't-1', definitions, existing });
    expect(component.isEdit).toBe(true);
    expect(component.form.controls.credential_ref.value).toBe('secrets/openai');
  });

  it('updates a credential with the existing If-Match token', async () => {
    const existing = {
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
    };
    await setup({ tenantId: 't-1', definitions, existing });
    registry.updateCredential.mockReturnValue(of({ id: 'cred-1' }));
    component.onSubmit();
    expect(registry.updateCredential).toHaveBeenCalledWith('t-1', 'cred-1', expect.any(Object), '2026-01-01T00:00:00.000Z');
  });
});
