import { AgentInternalController } from './agent-internal.controller';

describe('AgentInternalController (agent-facing /internal routes, Phase 4)', () => {
  function make(session: unknown = { id: 's1', tenantId: 't1' }) {
    const sessions = { findById: jest.fn().mockResolvedValue(session) };
    const getRuntimeConfig = { execute: jest.fn().mockResolvedValue({ session_id: 's1' }) };
    const applyEvent = { execute: jest.fn().mockResolvedValue(undefined) };
    const recordUtterances = { execute: jest.fn().mockResolvedValue(undefined) };
    const recordHops = { execute: jest.fn().mockResolvedValue(undefined) };
    const setSummary = { execute: jest.fn().mockResolvedValue(undefined) };
    const recordAlert = { execute: jest.fn().mockResolvedValue(undefined) };
    const recordGpuHeartbeat = { execute: jest.fn().mockResolvedValue(undefined) };
    const controller = new AgentInternalController(
      sessions as never,
      getRuntimeConfig as never,
      applyEvent as never,
      recordUtterances as never,
      recordHops as never,
      setSummary as never,
      recordAlert as never,
      recordGpuHeartbeat as never,
    );
    return { controller, sessions, getRuntimeConfig, applyEvent, recordUtterances, recordHops, setSummary, recordAlert, recordGpuHeartbeat };
  }

  it('runtimeConfig delegates to GetRuntimeConfigUseCase', async () => {
    const { controller, getRuntimeConfig } = make();
    const result = await controller.runtimeConfig('s1');
    expect(getRuntimeConfig.execute).toHaveBeenCalledWith('s1');
    expect(result).toEqual({ session_id: 's1' });
  });

  describe('event', () => {
    it('throws SESSION_NOT_FOUND for an unknown session id', async () => {
      const { controller } = make(null);
      await expect(controller.event('s1', { type: 'active', at: '2026-01-01T00:00:00.000Z' })).rejects.toMatchObject({
        code: 'SESSION_NOT_FOUND',
      });
    });

    it('maps the wire "joined" event to the domain "active" event', async () => {
      const { controller, applyEvent, sessions } = make();
      await controller.event('s1', { type: 'joined', at: '2026-01-01T00:00:00.000Z' });
      expect(applyEvent.execute).toHaveBeenCalledWith(await sessions.findById('s1'), 'active', undefined);
    });

    it('passes through every other event type and the error_code unchanged', async () => {
      const { controller, applyEvent } = make();
      await controller.event('s1', { type: 'failed', error_code: 'STT_UNAVAILABLE', at: '2026-01-01T00:00:00.000Z' });
      expect(applyEvent.execute).toHaveBeenCalledWith(expect.anything(), 'failed', 'STT_UNAVAILABLE');
    });
  });

  it('utterances delegates to RecordUtterancesUseCase', async () => {
    const { controller, recordUtterances } = make();
    await controller.utterances('s1', { items: [] });
    expect(recordUtterances.execute).toHaveBeenCalledWith('s1', { items: [] });
  });

  it('hops delegates to RecordHopsUseCase', async () => {
    const { controller, recordHops } = make();
    await controller.hops('s1', { items: [] });
    expect(recordHops.execute).toHaveBeenCalledWith('s1', { items: [] });
  });

  it('summary delegates to SetSessionSummaryUseCase', async () => {
    const { controller, setSummary } = make();
    await controller.summary('s1', { summary_status: 'ready', summary_text: 'hi' });
    expect(setSummary.execute).toHaveBeenCalledWith('s1', { summary_status: 'ready', summary_text: 'hi' });
  });

  it('alert delegates to RecordAlertUseCase', async () => {
    const { controller, recordAlert } = make();
    await controller.alert({ tenant_id: 't1', type: 'llm_failover', message: 'hold on' });
    expect(recordAlert.execute).toHaveBeenCalledWith({ tenant_id: 't1', type: 'llm_failover', message: 'hold on' });
  });

  it('gpuHeartbeat delegates to RecordGpuHeartbeatUseCase', async () => {
    const { controller, recordGpuHeartbeat } = make();
    const body = { hostname: 'gpu-1', role: 'stt' as const, gpu_util_pct: 50, mem_util_pct: 40, healthy: true, reported_at: '2026-01-01T00:00:00.000Z' };
    await controller.gpuHeartbeat(body);
    expect(recordGpuHeartbeat.execute).toHaveBeenCalledWith(body);
  });
});
