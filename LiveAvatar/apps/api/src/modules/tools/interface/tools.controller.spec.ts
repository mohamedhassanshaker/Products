import { ToolsController } from './tools.controller';

describe('ToolsController', () => {
  const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };

  function makeController() {
    const createTool = { execute: jest.fn().mockResolvedValue({}) };
    const getTool = { execute: jest.fn().mockResolvedValue({}) };
    const listTools = { execute: jest.fn().mockResolvedValue({ items: [] }) };
    const updateTool = { execute: jest.fn().mockResolvedValue({}) };
    const deleteTool = { execute: jest.fn().mockResolvedValue(undefined) };
    const testInvokeTool = { execute: jest.fn().mockResolvedValue({ ok: true }) };
    const controller = new ToolsController(
      createTool as never,
      getTool as never,
      listTools as never,
      updateTool as never,
      deleteTool as never,
      testInvokeTool as never,
    );
    return { controller, createTool, getTool, listTools, updateTool, deleteTool, testInvokeTool };
  }

  it('delegates list', () => {
    const { controller, listTools } = makeController();
    void controller.list(actor, 'tenant-1');
    expect(listTools.execute).toHaveBeenCalledWith(actor, 'tenant-1');
  });

  it('delegates create', () => {
    const { controller, createTool } = makeController();
    const body = { name: 'Lookup order', method: 'GET' as const, url: 'https://api.example.com' };
    void controller.create(actor, 'tenant-1', body);
    expect(createTool.execute).toHaveBeenCalledWith(actor, 'tenant-1', body);
  });

  it('delegates get', () => {
    const { controller, getTool } = makeController();
    void controller.get(actor, 'tenant-1', 'tool-1');
    expect(getTool.execute).toHaveBeenCalledWith(actor, 'tenant-1', 'tool-1');
  });

  it('delegates update', () => {
    const { controller, updateTool } = makeController();
    const body = { name: 'Renamed' };
    void controller.update(actor, 'tenant-1', 'tool-1', body, '2026-01-01T00:00:00.000Z');
    expect(updateTool.execute).toHaveBeenCalledWith(actor, 'tenant-1', 'tool-1', body, '2026-01-01T00:00:00.000Z');
  });

  it('delegates delete', async () => {
    const { controller, deleteTool } = makeController();
    await controller.remove(actor, 'tenant-1', 'tool-1');
    expect(deleteTool.execute).toHaveBeenCalledWith(actor, 'tenant-1', 'tool-1');
  });

  it('delegates test-invoke', () => {
    const { controller, testInvokeTool } = makeController();
    const body = { arguments: { order_id: '4821' } };
    void controller.testInvoke(actor, 'tenant-1', 'tool-1', body);
    expect(testInvokeTool.execute).toHaveBeenCalledWith(actor, 'tenant-1', 'tool-1', body);
  });
});
