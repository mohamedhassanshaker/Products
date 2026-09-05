import { GpuController } from './gpu.controller';

describe('GpuController', () => {
  it('nodes delegates to ListGpuNodesUseCase', async () => {
    const listGpuNodes = { execute: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
    const controller = new GpuController(listGpuNodes as never);
    const result = await controller.nodes({ role: 'stt' } as never);
    expect(listGpuNodes.execute).toHaveBeenCalledWith({ role: 'stt' });
    expect(result).toEqual({ items: [], total: 0 });
  });
});
