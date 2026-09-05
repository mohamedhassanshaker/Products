import { toProviderCredentialDto, toProviderDefinitionDto } from './provider-dto';

describe('provider-dto mappers', () => {
  it('maps a catalog record', () => {
    const dto = toProviderDefinitionDto({
      key: 'openai',
      category: 'llm',
      displayName: 'OpenAI',
      hosting: 'remote',
      interfaceName: 'ILLMProvider',
      requiresCredential: true,
      enabled: true,
      featureGaps: null,
    });
    expect(dto).toMatchObject({ key: 'openai', display_name: 'OpenAI', requires_credential: true });
  });

  it('maps a credential with a secret ref and a probe timestamp', () => {
    const dto = toProviderCredentialDto({
      id: 'cred-1',
      tenantId: 'tenant-1',
      providerKey: 'openai',
      displayLabel: 'default',
      endpointUrl: 'https://api.openai.com',
      credentialRef: 'secrets/openai',
      extra: {},
      lastProbeStatus: 'healthy',
      lastProbeAt: new Date('2026-01-01T00:00:00.000Z'),
      lastProbeError: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(dto.has_secret).toBe(true);
    expect(dto.last_probe_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('maps a credential with no secret ref and no probe yet', () => {
    const dto = toProviderCredentialDto({
      id: 'cred-2',
      tenantId: 'tenant-1',
      providerKey: 'faster-whisper',
      displayLabel: 'default',
      endpointUrl: 'http://localhost:9000',
      credentialRef: null,
      extra: {},
      lastProbeStatus: 'unknown',
      lastProbeAt: null,
      lastProbeError: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(dto.has_secret).toBe(false);
    expect(dto.last_probe_at).toBeNull();
  });
});
