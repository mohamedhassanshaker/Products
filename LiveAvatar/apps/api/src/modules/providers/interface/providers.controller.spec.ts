import { ProviderCredentialsController, ProviderDefinitionsController } from './providers.controller';

describe('ProviderDefinitionsController', () => {
  it('delegates list to the use case', () => {
    const listDefinitions = { execute: jest.fn().mockResolvedValue({ items: [] }) };
    const setEnabled = { execute: jest.fn() };
    const controller = new ProviderDefinitionsController(listDefinitions as never, setEnabled as never);
    void controller.list({ category: 'llm' });
    expect(listDefinitions.execute).toHaveBeenCalledWith({ category: 'llm' });
  });

  it('delegates enable/disable to the use case', () => {
    const listDefinitions = { execute: jest.fn() };
    const setEnabled = { execute: jest.fn().mockResolvedValue({}) };
    const controller = new ProviderDefinitionsController(listDefinitions as never, setEnabled as never);
    void controller.setEnabledRoute('openai', { enabled: false });
    expect(setEnabled.execute).toHaveBeenCalledWith('openai', false);
  });
});

describe('ProviderCredentialsController', () => {
  const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };

  function makeController() {
    const createCredential = { execute: jest.fn().mockResolvedValue({}) };
    const listCredentials = { execute: jest.fn().mockResolvedValue({ items: [] }) };
    const updateCredential = { execute: jest.fn().mockResolvedValue({}) };
    const deleteCredential = { execute: jest.fn().mockResolvedValue(undefined) };
    const probeCredential = { execute: jest.fn().mockResolvedValue({ status: 'healthy' }) };
    const controller = new ProviderCredentialsController(
      createCredential as never,
      listCredentials as never,
      updateCredential as never,
      deleteCredential as never,
      probeCredential as never,
    );
    return { controller, createCredential, listCredentials, updateCredential, deleteCredential, probeCredential };
  }

  it('delegates list', () => {
    const { controller, listCredentials } = makeController();
    void controller.list(actor, 'tenant-1', {});
    expect(listCredentials.execute).toHaveBeenCalledWith(actor, 'tenant-1', {});
  });

  it('delegates create', () => {
    const { controller, createCredential } = makeController();
    const body = { provider_key: 'openai', endpoint_url: 'https://api.openai.com' };
    void controller.create(actor, 'tenant-1', body);
    expect(createCredential.execute).toHaveBeenCalledWith(actor, 'tenant-1', body);
  });

  it('delegates update', () => {
    const { controller, updateCredential } = makeController();
    const body = { display_label: 'lab' };
    void controller.update(actor, 'tenant-1', 'cred-1', body, '2026-01-01T00:00:00.000Z');
    expect(updateCredential.execute).toHaveBeenCalledWith(actor, 'tenant-1', 'cred-1', body, '2026-01-01T00:00:00.000Z');
  });

  it('delegates delete', async () => {
    const { controller, deleteCredential } = makeController();
    await controller.remove(actor, 'tenant-1', 'cred-1');
    expect(deleteCredential.execute).toHaveBeenCalledWith(actor, 'tenant-1', 'cred-1');
  });

  it('delegates probe', () => {
    const { controller, probeCredential } = makeController();
    void controller.probe(actor, 'tenant-1', 'cred-1');
    expect(probeCredential.execute).toHaveBeenCalledWith(actor, 'tenant-1', 'cred-1');
  });
});
