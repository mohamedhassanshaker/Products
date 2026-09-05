import { GetResidencyUseCase } from './get-residency.use-case';

const actor = { id: 'a1', email: 'a@x.com', roles: ['admin'], tenantIds: ['t1'] };

describe('GetResidencyUseCase', () => {
  function make(tenant: unknown = { id: 't1' }, policy: unknown = { tenantId: 't1', sendToRemoteLlm: 'prompt_text_only', retainTranscriptsDays: 90, recordingsEnabled: false, updatedAt: new Date('2026-01-01T00:00:00.000Z') }) {
    const tenants = { findById: jest.fn().mockResolvedValue(tenant) };
    const residency = { findByTenantId: jest.fn().mockResolvedValue(policy) };
    const useCase = new GetResidencyUseCase(tenants as never, residency as never);
    return { useCase, tenants, residency };
  }

  it('404s for an unknown tenant', async () => {
    const { useCase } = make(null);
    await expect(useCase.execute(actor, 't1')).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('404s (not 403) for an unassigned admin', async () => {
    const { useCase } = make({ id: 't2' });
    await expect(useCase.execute(actor, 't2')).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('returns the policy DTO', async () => {
    const { useCase } = make();
    const result = await useCase.execute(actor, 't1');
    expect(result).toEqual({
      send_to_remote_llm: 'prompt_text_only',
      retain_transcripts_days: 90,
      recordings_enabled: false,
      updated_at: '2026-01-01T00:00:00.000Z',
    });
  });
});
