import { ResidencyController } from './residency.controller';

describe('ResidencyController', () => {
  function make() {
    const getResidency = { execute: jest.fn().mockResolvedValue({ send_to_remote_llm: 'prompt_text_only' }) };
    const updateResidency = { execute: jest.fn().mockResolvedValue({ send_to_remote_llm: 'none', warnings: [] }) };
    const controller = new ResidencyController(getResidency as never, updateResidency as never);
    return { controller, getResidency, updateResidency };
  }

  const actor = { id: 'a1', email: 'a@x.com', roles: ['admin'], tenantIds: ['t1'] };

  it('get delegates to GetResidencyUseCase', async () => {
    const { controller, getResidency } = make();
    const result = await controller.get(actor as never, 't1');
    expect(getResidency.execute).toHaveBeenCalledWith(actor, 't1');
    expect(result).toEqual({ send_to_remote_llm: 'prompt_text_only' });
  });

  it('update delegates to UpdateResidencyUseCase with the If-Match header', async () => {
    const { controller, updateResidency } = make();
    const body = { send_to_remote_llm: 'none', retain_transcripts_days: 30, recordings_enabled: false };
    const result = await controller.update(actor as never, 't1', body as never, '2026-01-01T00:00:00.000Z');
    expect(updateResidency.execute).toHaveBeenCalledWith(actor, 't1', body, '2026-01-01T00:00:00.000Z');
    expect(result).toEqual({ send_to_remote_llm: 'none', warnings: [] });
  });
});
