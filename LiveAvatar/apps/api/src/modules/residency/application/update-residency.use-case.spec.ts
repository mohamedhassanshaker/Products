import { UpdateResidencyUseCase } from './update-residency.use-case';

const actor = { id: 'a1', email: 'a@x.com', roles: ['admin'], tenantIds: ['t1'] };
const ifMatch = new Date('2026-01-01T00:00:00.000Z').toISOString();

function makeUpdatedPolicy(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 't1',
    sendToRemoteLlm: 'prompt_text_only',
    retainTranscriptsDays: 90,
    recordingsEnabled: false,
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('UpdateResidencyUseCase', () => {
  function make(options: { config?: unknown; definition?: unknown } = {}) {
    const tenants = { findById: jest.fn().mockResolvedValue({ id: 't1' }) };
    const configs = { findByTenantId: jest.fn().mockResolvedValue(options.config ?? null) };
    const definitions = { findByKey: jest.fn().mockResolvedValue(options.definition ?? null) };
    const residency = { update: jest.fn().mockResolvedValue(makeUpdatedPolicy()) };
    const useCase = new UpdateResidencyUseCase(tenants as never, configs as never, definitions as never, residency as never);
    return { useCase, tenants, configs, definitions, residency };
  }

  it('404s for an unknown tenant', async () => {
    const { useCase } = make();
    (await make()).tenants.findById.mockResolvedValue(null);
    const other = make();
    other.tenants.findById.mockResolvedValue(null);
    await expect(
      other.useCase.execute(actor, 't1', { send_to_remote_llm: 'none', retain_transcripts_days: 90, recordings_enabled: false }, ifMatch),
    ).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
    void useCase;
  });

  it('400s CONFIG_RETENTION_INVALID outside 1-730', async () => {
    const { useCase } = make();
    await expect(
      useCase.execute(actor, 't1', { send_to_remote_llm: 'prompt_text_only', retain_transcripts_days: 0, recordings_enabled: false }, ifMatch),
    ).rejects.toMatchObject({ code: 'CONFIG_RETENTION_INVALID' });
  });

  it('422s CONFIG_RESIDENCY_BLOCKS_LLM when none is chosen while the published config uses a remote LLM', async () => {
    const { useCase } = make({
      config: { status: 'published', providers: { llm: 'openai' } },
      definition: { hosting: 'remote' },
    });
    await expect(
      useCase.execute(actor, 't1', { send_to_remote_llm: 'none', retain_transcripts_days: 90, recordings_enabled: false }, ifMatch),
    ).rejects.toMatchObject({ code: 'CONFIG_RESIDENCY_BLOCKS_LLM', httpStatus: 422 });
  });

  it('allows none when no config is published yet', async () => {
    const { useCase, residency } = make({ config: null });
    await useCase.execute(actor, 't1', { send_to_remote_llm: 'none', retain_transcripts_days: 90, recordings_enabled: false }, ifMatch);
    expect(residency.update).toHaveBeenCalled();
  });

  it('allows none when the published LLM is self-hosted', async () => {
    const { useCase, residency } = make({
      config: { status: 'published', providers: { llm: 'faster-whisper' } },
      definition: { hosting: 'self_hosted' },
    });
    await useCase.execute(actor, 't1', { send_to_remote_llm: 'none', retain_transcripts_days: 90, recordings_enabled: false }, ifMatch);
    expect(residency.update).toHaveBeenCalled();
  });

  it('409s CONFIG_CONFLICT for a malformed If-Match value', async () => {
    const { useCase } = make();
    await expect(
      useCase.execute(actor, 't1', { send_to_remote_llm: 'prompt_text_only', retain_transcripts_days: 90, recordings_enabled: false }, 'not-a-date'),
    ).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
  });

  it('409s CONFIG_CONFLICT when the repository reports a stale If-Match', async () => {
    const { useCase, residency } = make();
    residency.update.mockResolvedValue('conflict');
    await expect(
      useCase.execute(actor, 't1', { send_to_remote_llm: 'prompt_text_only', retain_transcripts_days: 90, recordings_enabled: false }, ifMatch),
    ).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
  });

  it('warns RECORDINGS_NOT_IMPLEMENTED when recordings_enabled is true, but still saves', async () => {
    const { useCase, residency } = make();
    residency.update.mockResolvedValue(makeUpdatedPolicy({ recordingsEnabled: true }));
    const result = await useCase.execute(
      actor,
      't1',
      { send_to_remote_llm: 'prompt_text_only', retain_transcripts_days: 90, recordings_enabled: true },
      ifMatch,
    );
    expect(result.warnings).toEqual(['RECORDINGS_NOT_IMPLEMENTED']);
  });

  it('returns no warnings when recordings stay disabled', async () => {
    const { useCase } = make();
    const result = await useCase.execute(
      actor,
      't1',
      { send_to_remote_llm: 'prompt_text_only', retain_transcripts_days: 90, recordings_enabled: false },
      ifMatch,
    );
    expect(result.warnings).toEqual([]);
  });
});
