import { RecordGpuHeartbeatUseCase } from './record-gpu-heartbeat.use-case';

describe('RecordGpuHeartbeatUseCase', () => {
  it('maps the wire request into the repository call, defaulting tenant_id to null', async () => {
    const nodes = { recordHeartbeat: jest.fn().mockResolvedValue(undefined) };
    const useCase = new RecordGpuHeartbeatUseCase(nodes as never);
    await useCase.execute({ hostname: 'gpu-1', role: 'stt', gpu_util_pct: 40, mem_util_pct: 30, healthy: true, reported_at: '2026-01-01T00:00:00.000Z' });
    expect(nodes.recordHeartbeat).toHaveBeenCalledWith({
      hostname: 'gpu-1',
      role: 'stt',
      gpuUtilPct: 40,
      memUtilPct: 30,
      healthy: true,
      tenantId: null,
      reportedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('passes through an explicit tenant_id', async () => {
    const nodes = { recordHeartbeat: jest.fn().mockResolvedValue(undefined) };
    const useCase = new RecordGpuHeartbeatUseCase(nodes as never);
    await useCase.execute({ hostname: 'gpu-1', role: 'avatar', gpu_util_pct: 40, mem_util_pct: 30, healthy: false, tenant_id: 't1', reported_at: '2026-01-01T00:00:00.000Z' });
    expect(nodes.recordHeartbeat).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }));
  });
});
