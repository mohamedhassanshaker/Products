import { describe, expect, it, vi } from 'vitest';
import type { AiModelSelection } from '@/server/platform/ai-models';

const resolve = vi.fn<() => Promise<AiModelSelection>>();
const getAiModelResolver = vi.fn(async () => ({ resolve }));
vi.mock('@/server/platform/ai-models', () => ({ getAiModelResolver: (...args: unknown[]) => getAiModelResolver(...(args as [])) }));

const { resolveModelForTenant } = await import('./ai-model-resolver');

/** `resolveModelForTenant`'s only job is to delegate to Phase 2b's already-built `AiModelResolver`
 * singleton (see this file's own doc comment) — this suite proves the delegation, not
 * `AiModelResolver`'s own resolution rules (that suite lives at
 * `server/platform/ai-models/application/ai-model-resolver.test.ts`). */
describe('resolveModelForTenant', () => {
  it('delegates to the shared AiModelResolver singleton with the given tenantId, returning its result unchanged', async () => {
    const selection: AiModelSelection = { source: 'platform_default', primary: { openRouterModelId: 'anthropic/claude-3.5-haiku', displayName: 'Claude 3.5 Haiku' } };
    resolve.mockResolvedValue(selection);

    const result = await resolveModelForTenant('tenant-1');

    expect(getAiModelResolver).toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledWith('tenant-1');
    expect(result).toBe(selection);
  });

  it('propagates a rejection from the resolver unchanged (e.g. AiNotConfiguredError)', async () => {
    resolve.mockRejectedValue(new Error('no model configured'));
    await expect(resolveModelForTenant('tenant-2')).rejects.toThrow('no model configured');
  });
});
