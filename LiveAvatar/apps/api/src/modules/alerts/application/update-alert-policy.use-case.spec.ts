import { UpdateAlertPolicyUseCase } from './update-alert-policy.use-case';

const actor = { id: 'a1', email: 'a@x.com', roles: ['admin'], tenantIds: ['t1'] };
const ifMatch = new Date('2026-01-01T00:00:00.000Z').toISOString();

function makeUpdated(overrides: Record<string, unknown> = {}) {
  return { tenantId: 't1', retryMaxAttempts: 3, retryBackoffMs: [200, 400, 800], degradedModeMessage: 'msg', updatedAt: new Date('2026-01-02T00:00:00.000Z'), ...overrides };
}

/** Phase 9 (BL-035): the primary leg now lives on the first `llm`-type `reasoning.graph[]` node. */
function reasoningWithPrimary(provider: string, model: string) {
  return {
    entry_node_id: 'llm-1',
    background_entry_node_ids: [],
    turn_budget_ms: 3000,
    graph: [
      {
        id: 'llm-1',
        type: 'llm',
        name: 'Answer',
        lane: 'foreground',
        on_error: { action: 'degrade' },
        on_deadline: { action: 'degrade' },
        provider,
        model,
        retry: { max_attempts: 3, backoff_ms: [200, 400, 800] },
        next_node_id: null,
      },
    ],
  };
}

describe('UpdateAlertPolicyUseCase', () => {
  function make(config: unknown = null) {
    const tenants = { findById: jest.fn().mockResolvedValue({ id: 't1' }) };
    const alertPolicy = { update: jest.fn().mockResolvedValue(makeUpdated()) };
    const configs = { findByTenantId: jest.fn().mockResolvedValue(config) };
    const useCase = new UpdateAlertPolicyUseCase(tenants as never, alertPolicy as never, configs as never);
    return { useCase, tenants, alertPolicy, configs };
  }

  it('404s for an unknown tenant', async () => {
    const { useCase, tenants } = make();
    tenants.findById.mockResolvedValue(null);
    await expect(
      useCase.execute(actor, 't1', { retry_max_attempts: 3, retry_backoff_ms: [1, 2, 3], degraded_mode_message: 'm' }, ifMatch),
    ).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('400s CONFIG_RETRY_INVALID when backoff length does not match max_attempts', async () => {
    const { useCase } = make();
    await expect(
      useCase.execute(actor, 't1', { retry_max_attempts: 3, retry_backoff_ms: [1, 2], degraded_mode_message: 'm' }, ifMatch),
    ).rejects.toMatchObject({ code: 'CONFIG_RETRY_INVALID' });
  });

  it('400s CONFIG_RETRY_INVALID for max_attempts outside 1-5', async () => {
    const { useCase } = make();
    await expect(
      useCase.execute(actor, 't1', { retry_max_attempts: 6, retry_backoff_ms: [1, 2, 3, 4, 5, 6], degraded_mode_message: 'm' }, ifMatch),
    ).rejects.toMatchObject({ code: 'CONFIG_RETRY_INVALID' });
  });

  it('422s CONFIG_FALLBACK_IDENTICAL when llm_fallback matches the primary', async () => {
    const { useCase } = make({ structured: { reasoning: reasoningWithPrimary('openai', 'gpt-4o') } });
    await expect(
      useCase.execute(
        actor,
        't1',
        { retry_max_attempts: 3, retry_backoff_ms: [1, 2, 3], degraded_mode_message: 'm', llm_fallback: { provider: 'openai', model: 'gpt-4o' } },
        ifMatch,
      ),
    ).rejects.toMatchObject({ code: 'CONFIG_FALLBACK_IDENTICAL', httpStatus: 422 });
  });

  it('allows a distinct llm_fallback without persisting it (identity stays Agent-Builder-owned)', async () => {
    const { useCase, alertPolicy } = make({ structured: { reasoning: reasoningWithPrimary('openai', 'gpt-4o') } });
    await useCase.execute(
      actor,
      't1',
      { retry_max_attempts: 3, retry_backoff_ms: [1, 2, 3], degraded_mode_message: 'm', llm_fallback: { provider: 'anthropic', model: 'claude-3' } },
      ifMatch,
    );
    expect(alertPolicy.update).toHaveBeenCalledWith(
      't1',
      { retryMaxAttempts: 3, retryBackoffMs: [1, 2, 3], degradedModeMessage: 'm' },
      expect.any(Date),
    );
  });

  it('409s CONFIG_CONFLICT for a malformed If-Match', async () => {
    const { useCase } = make();
    await expect(
      useCase.execute(actor, 't1', { retry_max_attempts: 3, retry_backoff_ms: [1, 2, 3], degraded_mode_message: 'm' }, 'bad'),
    ).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
  });

  it('409s CONFIG_CONFLICT on a repository conflict', async () => {
    const { useCase, alertPolicy } = make();
    alertPolicy.update.mockResolvedValue('conflict');
    await expect(
      useCase.execute(actor, 't1', { retry_max_attempts: 3, retry_backoff_ms: [1, 2, 3], degraded_mode_message: 'm' }, ifMatch),
    ).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
  });

  it('returns the updated policy DTO', async () => {
    const { useCase } = make();
    const result = await useCase.execute(actor, 't1', { retry_max_attempts: 3, retry_backoff_ms: [1, 2, 3], degraded_mode_message: 'm' }, ifMatch);
    expect(result.retry_max_attempts).toBe(3);
    expect(result.llm_fallback).toBeNull();
  });
});
