import type { ProviderDefinitionRepositoryPort } from '../domain/ports';
import { ListProviderDefinitionsUseCase } from './list-provider-definitions.use-case';

describe('ListProviderDefinitionsUseCase', () => {
  it('maps repository records to DTOs', async () => {
    const repo: jest.Mocked<ProviderDefinitionRepositoryPort> = {
      list: jest.fn().mockResolvedValue([
        {
          key: 'livekit',
          category: 'transport',
          displayName: 'LiveKit',
          hosting: 'self_hosted',
          interfaceName: 'ITransportProvider',
          requiresCredential: true,
          enabled: true,
          featureGaps: null,
        },
      ]),
      findByKey: jest.fn(),
      countEnabledInCategory: jest.fn(),
      setEnabled: jest.fn(),
    };
    const useCase = new ListProviderDefinitionsUseCase(repo);
    const result = await useCase.execute({});
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ key: 'livekit', hosting: 'self_hosted' });
    expect(repo.list).toHaveBeenCalledWith({});
  });
});
