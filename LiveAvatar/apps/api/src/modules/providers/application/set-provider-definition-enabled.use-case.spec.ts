import type { ProviderDefinitionRepositoryPort } from '../domain/ports';
import type { ProviderDefinitionRecord } from '../domain/provider';
import { SetProviderDefinitionEnabledUseCase } from './set-provider-definition-enabled.use-case';

function makeDef(overrides: Partial<ProviderDefinitionRecord> = {}): ProviderDefinitionRecord {
  return {
    key: 'openai',
    category: 'llm',
    displayName: 'OpenAI',
    hosting: 'remote',
    interfaceName: 'ILLMProvider',
    requiresCredential: true,
    enabled: true,
    featureGaps: null,
    ...overrides,
  };
}

describe('SetProviderDefinitionEnabledUseCase', () => {
  let repo: jest.Mocked<ProviderDefinitionRepositoryPort>;
  let useCase: SetProviderDefinitionEnabledUseCase;

  beforeEach(() => {
    repo = {
      list: jest.fn(),
      findByKey: jest.fn(),
      countEnabledInCategory: jest.fn(),
      setEnabled: jest.fn(),
    };
    useCase = new SetProviderDefinitionEnabledUseCase(repo);
  });

  it('404s an unknown key', async () => {
    repo.findByKey.mockResolvedValue(null);
    await expect(useCase.execute('nope', false)).rejects.toMatchObject({ code: 'PROVIDER_UNKNOWN' });
  });

  it('blocks disabling the last enabled provider in a category', async () => {
    repo.findByKey.mockResolvedValue(makeDef());
    repo.countEnabledInCategory.mockResolvedValue(1);
    await expect(useCase.execute('openai', false)).rejects.toMatchObject({
      code: 'PROVIDER_CATEGORY_EMPTY',
      httpStatus: 422,
    });
    expect(repo.setEnabled).not.toHaveBeenCalled();
  });

  it('allows disabling when another provider remains enabled in the category', async () => {
    repo.findByKey.mockResolvedValue(makeDef());
    repo.countEnabledInCategory.mockResolvedValue(2);
    repo.setEnabled.mockResolvedValue(makeDef({ enabled: false }));
    const result = await useCase.execute('openai', false);
    expect(result.enabled).toBe(false);
  });

  it('404s defensively when setEnabled races to not-found (deleted mid-flight)', async () => {
    repo.findByKey.mockResolvedValue(makeDef());
    repo.countEnabledInCategory.mockResolvedValue(2);
    repo.setEnabled.mockResolvedValue(null);
    await expect(useCase.execute('openai', false)).rejects.toMatchObject({ code: 'PROVIDER_UNKNOWN' });
  });

  it('allows re-enabling without the category-empty check', async () => {
    repo.findByKey.mockResolvedValue(makeDef({ enabled: false }));
    repo.setEnabled.mockResolvedValue(makeDef({ enabled: true }));
    const result = await useCase.execute('openai', true);
    expect(result.enabled).toBe(true);
    expect(repo.countEnabledInCategory).not.toHaveBeenCalled();
  });
});
