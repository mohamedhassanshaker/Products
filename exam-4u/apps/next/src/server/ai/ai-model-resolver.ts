import { getAiModelResolver, type AiModelSelection } from '@/server/platform/ai-models';

/**
 * `server/ai`'s thin wrapper around Phase 2b's already-built `AiModelResolver`
 * (`server/platform/ai-models`) — migration plan Phase 5's own "wire Phase 2b's already-built
 * `AiModelResolver` into this new AI-runner path" item. The resolver's own resolution logic
 * (tenant-assignment-or-platform-default, caching, invalidation) is entirely untouched by this
 * dispatch; this file only gives `server/ai/application/ai.service.ts` a single, obviously-named
 * entry point to call, sharing the exact same cached singleton `server/platform/ai-models`'s own
 * `AiModelsService` invalidates on every allowlist/assignment mutation (per `getAiModelResolver()`'s
 * own doc comment: "so Phase 5 can obtain the *same* cached instance... rather than constructing a
 * second, out-of-sync resolver later").
 *
 * @throws {import('@/server/platform/ai-models').AiNotConfiguredError} if the tenant has no explicit
 *   assignment and the platform allowlist has no current default (i.e. it is empty).
 */
export async function resolveModelForTenant(tenantId: string): Promise<AiModelSelection> {
  const resolver = await getAiModelResolver();
  return resolver.resolve(tenantId);
}
