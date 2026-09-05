import { ListGpuNodesUseCase } from './list-gpu-nodes.use-case';

function row(overrides: Record<string, unknown> = {}) {
  return { hostname: 'gpu-1', role: 'stt', gpuUtilPct: 40, memUtilPct: 30, healthy: true, autoscalerNote: 'not_configured', reportedAt: new Date(), ...overrides };
}

describe('ListGpuNodesUseCase', () => {
  function make(rows: unknown[] = []) {
    const nodes = { listLatestPerHost: jest.fn().mockResolvedValue(rows) };
    const useCase = new ListGpuNodesUseCase(nodes as never);
    return { useCase, nodes };
  }

  it('returns an empty list as a valid state (FR-GPU-1)', async () => {
    const { useCase } = make([]);
    const result = await useCase.execute({});
    expect(result).toEqual({ items: [], total: 0 });
  });

  it('passes role/tenant_id filters through', async () => {
    const { useCase, nodes } = make();
    await useCase.execute({ role: 'avatar', tenant_id: 't1' });
    expect(nodes.listLatestPerHost).toHaveBeenCalledWith({ role: 'avatar', tenantId: 't1' });
  });

  it('reports a fresh, healthy heartbeat as healthy', async () => {
    const { useCase } = make([row()]);
    const result = await useCase.execute({});
    expect(result.items[0].healthy).toBe(true);
    expect(result.items[0].autoscaler).toBe('not_configured');
  });

  it('overrides healthy to false for a heartbeat older than 60s, regardless of the reported value (FR-GPU-3)', async () => {
    const stale = new Date(Date.now() - 61_000);
    const { useCase } = make([row({ healthy: true, reportedAt: stale })]);
    const result = await useCase.execute({});
    expect(result.items[0].healthy).toBe(false);
  });

  it('surfaces autoscaler: external when the note says so', async () => {
    const { useCase } = make([row({ autoscalerNote: 'external' })]);
    const result = await useCase.execute({});
    expect(result.items[0].autoscaler).toBe('external');
  });
});
