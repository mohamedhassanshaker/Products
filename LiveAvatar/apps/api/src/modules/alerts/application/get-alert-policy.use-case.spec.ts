import { GetAlertPolicyUseCase } from './get-alert-policy.use-case';

const actor = { id: 'a1', email: 'a@x.com', roles: ['admin'], tenantIds: ['t1'] };

function makePolicy(overrides: Record<string, unknown> = {}) {
  return { tenantId: 't1', retryMaxAttempts: 3, retryBackoffMs: [200, 400, 800], degradedModeMessage: 'msg', updatedAt: new Date('2026-01-01T00:00:00.000Z'), ...overrides };
}

describe('GetAlertPolicyUseCase', () => {
  function make(tenant: unknown = { id: 't1' }, policy: unknown = makePolicy(), config: unknown = null) {
    const tenants = { findById: jest.fn().mockResolvedValue(tenant) };
    const alertPolicy = { findByTenantId: jest.fn().mockResolvedValue(policy) };
    const configs = { findByTenantId: jest.fn().mockResolvedValue(config) };
    const useCase = new GetAlertPolicyUseCase(tenants as never, alertPolicy as never, configs as never);
    return { useCase, tenants, alertPolicy, configs };
  }

  it('404s for an unknown tenant', async () => {
    const { useCase } = make(null);
    await expect(useCase.execute(actor, 't1')).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('returns null llm_fallback when no config exists', async () => {
    const { useCase } = make();
    const result = await useCase.execute(actor, 't1');
    expect(result.llm_fallback).toBeNull();
    expect(result.retry_max_attempts).toBe(3);
  });

  it('projects the fallback identity from the structured config, read-only', async () => {
    const { useCase } = make({ id: 't1' }, makePolicy(), {
      structured: {
        reasoning: {
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
              provider: 'openai',
              model: 'gpt-4o',
              retry: { max_attempts: 3, backoff_ms: [200, 400, 800] },
              next_node_id: null,
              fallback: { provider: 'anthropic', model: 'claude-3', credential_ref: 'ref1' },
            },
          ],
        },
      },
    });
    const result = await useCase.execute(actor, 't1');
    expect(result.llm_fallback).toEqual({ provider: 'anthropic', model: 'claude-3', credential_ref: 'ref1' });
  });
});
