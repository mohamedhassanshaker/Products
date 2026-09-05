import { KnowledgeSourcesController } from './knowledge-sources.controller';

describe('KnowledgeSourcesController', () => {
  const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };
  const file = { buffer: Buffer.from('hi'), originalname: 'a.txt', mimetype: 'text/plain', size: 2 } as Express.Multer.File;

  function makeController() {
    const createSource = { execute: jest.fn().mockResolvedValue({}) };
    const listSources = { execute: jest.fn().mockResolvedValue({ items: [] }) };
    const getSource = { execute: jest.fn().mockResolvedValue({}) };
    const updateSource = { execute: jest.fn().mockResolvedValue({}) };
    const deleteSource = { execute: jest.fn().mockResolvedValue(undefined) };
    const estimateReindex = {
      execute: jest.fn().mockResolvedValue({ chunk_count: 0, estimated_cost_usd: 0, estimated_duration_ms: 0, is_estimate: true }),
    };
    const triggerReindex = { execute: jest.fn().mockResolvedValue({ enqueued: true }) };
    const controller = new KnowledgeSourcesController(
      createSource as never,
      listSources as never,
      getSource as never,
      updateSource as never,
      deleteSource as never,
      estimateReindex as never,
      triggerReindex as never,
    );
    return { controller, createSource, listSources, getSource, updateSource, deleteSource, estimateReindex, triggerReindex };
  }

  it('delegates create with the uploaded file and parsed body', () => {
    const { controller, createSource } = makeController();
    const body = { name: 'Docs' };
    void controller.create(actor, 'tenant-1', file, body);
    expect(createSource.execute).toHaveBeenCalledWith(actor, 'tenant-1', body, file);
  });

  it('delegates list', () => {
    const { controller, listSources } = makeController();
    void controller.list(actor, 'tenant-1');
    expect(listSources.execute).toHaveBeenCalledWith(actor, 'tenant-1');
  });

  it('delegates get', () => {
    const { controller, getSource } = makeController();
    void controller.get(actor, 'tenant-1', 'source-1');
    expect(getSource.execute).toHaveBeenCalledWith(actor, 'tenant-1', 'source-1');
  });

  it('delegates update', () => {
    const { controller, updateSource } = makeController();
    const body = { name: 'Renamed' };
    void controller.update(actor, 'tenant-1', 'source-1', body, '2026-01-01T00:00:00.000Z');
    expect(updateSource.execute).toHaveBeenCalledWith(actor, 'tenant-1', 'source-1', body, '2026-01-01T00:00:00.000Z');
  });

  it('delegates delete', async () => {
    const { controller, deleteSource } = makeController();
    await controller.remove(actor, 'tenant-1', 'source-1');
    expect(deleteSource.execute).toHaveBeenCalledWith(actor, 'tenant-1', 'source-1');
  });

  it('delegates reindex-estimate', () => {
    const { controller, estimateReindex } = makeController();
    void controller.reindexEstimate(actor, 'tenant-1', 'source-1');
    expect(estimateReindex.execute).toHaveBeenCalledWith(actor, 'tenant-1', 'source-1');
  });

  it('delegates reindex', () => {
    const { controller, triggerReindex } = makeController();
    void controller.reindex(actor, 'tenant-1', 'source-1');
    expect(triggerReindex.execute).toHaveBeenCalledWith(actor, 'tenant-1', 'source-1');
  });
});
