import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ProvidersApiService } from '@liveavatar/web-shared';
import { ProviderRegistryService } from './provider-registry.service';

describe('ProviderRegistryService', () => {
  let service: ProviderRegistryService;
  let api: jest.Mocked<Pick<ProvidersApiService, keyof ProvidersApiService>>;

  beforeEach(() => {
    api = {
      listDefinitions: jest.fn(() => of({ items: [] })),
      setDefinitionEnabled: jest.fn(() => of({})),
      listCredentials: jest.fn(() => of({ items: [] })),
      createCredential: jest.fn(() => of({})),
      updateCredential: jest.fn(() => of({})),
      deleteCredential: jest.fn(() => of(undefined)),
      probeCredential: jest.fn(() => of({})),
    } as never;

    TestBed.configureTestingModule({ providers: [{ provide: ProvidersApiService, useValue: api }] });
    service = TestBed.inject(ProviderRegistryService);
  });

  it('delegates listDefinitions', () => {
    service.listDefinitions().subscribe();
    expect(api.listDefinitions).toHaveBeenCalled();
  });

  it('delegates setDefinitionEnabled', () => {
    service.setDefinitionEnabled('openai', { enabled: false }).subscribe();
    expect(api.setDefinitionEnabled).toHaveBeenCalledWith('openai', { enabled: false });
  });

  it('delegates listCredentials', () => {
    service.listCredentials('t-1').subscribe();
    expect(api.listCredentials).toHaveBeenCalledWith('t-1');
  });

  it('mints a fresh Idempotency-Key on createCredential', () => {
    service.createCredential('t-1', { provider_key: 'openai', endpoint_url: 'https://api.openai.com' }).subscribe();
    expect(api.createCredential).toHaveBeenCalledWith(
      't-1',
      { provider_key: 'openai', endpoint_url: 'https://api.openai.com' },
      expect.any(String),
    );
  });

  it('delegates updateCredential', () => {
    service.updateCredential('t-1', 'cred-1', { display_label: 'lab' }, '2026-01-01').subscribe();
    expect(api.updateCredential).toHaveBeenCalledWith('t-1', 'cred-1', { display_label: 'lab' }, '2026-01-01');
  });

  it('delegates deleteCredential', () => {
    service.deleteCredential('t-1', 'cred-1').subscribe();
    expect(api.deleteCredential).toHaveBeenCalledWith('t-1', 'cred-1');
  });

  it('delegates probeCredential', () => {
    service.probeCredential('t-1', 'cred-1').subscribe();
    expect(api.probeCredential).toHaveBeenCalledWith('t-1', 'cred-1');
  });
});
