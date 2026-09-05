import { createHash } from "node:crypto";
import type { TSchema, Static } from "@sinclair/typebox";
import type { TenantContext } from "@nextbot/db";
import { KmsEnvelopeSecretsProvider } from "@nextbot/secrets";
import { embed, generateStructured, generateText, resolveModel, type ChatMessage, type LogicalModelName, type ResolvedChainEntry } from "@nextbot/ai-registry";
import { NoInRegionProviderError, ModelBudgetExceededError } from "@nextbot/contracts";
import { getAllowOutOfRegionInference } from "@nextbot/tenancy";
import { adapterFor } from "../domain/adapter-registry.js";
import { getCredentialForDecrypt } from "../infrastructure/credential-repository.js";
import { getProvider, getCatalogEntry } from "../infrastructure/model-gateway-repository.js";
import { getRouteByName, type ModelRouteVersionRow } from "../infrastructure/route-repository.js";
import { getRouteVersion, getCacheEntry, upsertCacheEntry, insertUsageEvent, listApplicableModelBudgets, sumModelUsageCostSince } from "../infrastructure/route-repository.js";

/**
 * Target Architecture Blueprint Phase 2 (BL-33, LLD §14.8, ADR-0006) — the actual
 * model-gateway call path, moved here from `@nextbot/agent-platform` (which now
 * re-exports these unchanged so `enforceModelBudget`/`callModelGatewayText`/
 * `callModelGatewayStructured` keep their existing public signature for every
 * pre-existing caller, LLD §14.9.6's "extract Module F"). Resolves a Route v2
 * `model_route_version`'s `chain_json` hops (catalog-entry-pinned, never a free-text
 * model string) into `ai-registry`'s `ResolvedChainEntry[]`, then calls through
 * exactly as ADR-0006 always has.
 */

let secretsProvider: KmsEnvelopeSecretsProvider | undefined;
function getSecretsProvider(): KmsEnvelopeSecretsProvider {
  if (!secretsProvider) secretsProvider = new KmsEnvelopeSecretsProvider();
  return secretsProvider;
}

async function decryptModelCredential(ctx: TenantContext, credentialId: string): Promise<string | undefined> {
  const encrypted = await getCredentialForDecrypt(ctx, credentialId);
  if (!encrypted) return undefined;
  return getSecretsProvider().get(encrypted.ciphertext, encrypted.dekRef, { tenantId: ctx.tenantId, kind: "model-provider-key", id: credentialId });
}

export interface ResolvedRouteChain {
  chain: ResolvedChainEntry[];
  totalTimeoutMs: number;
  cacheMode: "Off" | "ExactMatch" | "Semantic";
  routeVersionId: string | null;
  /** Per-hop catalog-entry/provider ids, aligned by index with `chain`, so the call
   * site can attribute a `model_usage_event` row to the exact hop that actually
   * served the request (FR-AGT-24). */
  hopAttribution: Array<{ catalogEntryId: string; providerId: string }>;
}

/** Shared by-version resolution logic — the per-hop provider/catalog-entry lookup,
 *  region filtering, and credential decryption every route resolution needs,
 *  regardless of whether the caller resolved to this version by NAME (current
 *  Published version, `resolveModelChainForRoute`) or by an explicit, immutable
 *  `routeVersionId` (`resolveModelChainForRouteVersion` — Phase 7b's pinned-call
 *  requirement). Extracted so both paths can never drift apart. */
async function resolveChainFromVersion(ctx: TenantContext, routeKey: string, version: ModelRouteVersionRow): Promise<ResolvedRouteChain> {
  const allowOutOfRegion = await getAllowOutOfRegionInference(ctx);
  const resolved: ResolvedChainEntry[] = [];
  const hopAttribution: Array<{ catalogEntryId: string; providerId: string }> = [];

  const sortedHops = [...version.chainJson].sort((a, b) => a.ordinal - b.ordinal);
  for (const hop of sortedHops) {
    const provider = await getProvider(ctx, hop.providerId);
    const entry = await getCatalogEntry(ctx, hop.catalogEntryId);
    if (!provider || !entry) continue; // referential edge case — a referenced row was hard-deleted after this version was published; skip rather than crash the whole chain.

    const inRegion = provider.regionsServed.length === 0 || provider.regionsServed.includes(ctx.region) || provider.region === ctx.region;
    if (!inRegion && !allowOutOfRegion) continue; // FR-SEC-05/FR-AGT-25 runtime defense-in-depth — save-time validation should already have prevented this.

    let apiKey: string | undefined;
    if (provider.credentialId) apiKey = await decryptModelCredential(ctx, provider.credentialId);

    resolved.push({
      providerKey: adapterFor(provider.type).transportKey,
      model: entry.modelId,
      baseUrl: provider.baseUrl ?? undefined,
      apiKey,
      maxTokens: hop.params.maxTokens,
      timeoutMs: hop.timeoutMs,
    });
    hopAttribution.push({ catalogEntryId: entry.id, providerId: provider.id });
  }

  if (resolved.length === 0) throw new NoInRegionProviderError(routeKey, ctx.region);
  return { chain: resolved, totalTimeoutMs: version.policyJson.totalTimeoutMs, cacheMode: version.policyJson.cacheMode, routeVersionId: version.id, hopAttribution };
}

/**
 * Resolution precedence (LLD §7.1, now via Route v2): a Published `model_route`'s
 * `current_version_id` -> env default (`ai-registry`'s `resolveModel`) when no route
 * exists at all for `routeKey` under this tenant.
 */
export async function resolveModelChainForRoute(ctx: TenantContext, routeKey: string): Promise<ResolvedRouteChain> {
  const route = await getRouteByName(ctx, routeKey);
  if (!route || !route.currentVersionId) {
    return { chain: [resolveModel(routeKey as LogicalModelName)], totalTimeoutMs: 30000, cacheMode: "Off", routeVersionId: null, hopAttribution: [] };
  }
  const version = await getRouteVersion(ctx, route.currentVersionId);
  if (!version) {
    return { chain: [resolveModel(routeKey as LogicalModelName)], totalTimeoutMs: 30000, cacheMode: "Off", routeVersionId: null, hopAttribution: [] };
  }
  return resolveChainFromVersion(ctx, routeKey, version);
}

/**
 * Target Architecture Blueprint Phase 7b (FR-KB-03) — resolves an EXACT, already-
 * known `model_route_version` id, never "whatever is currently Published under this
 * route name." Every existing caller (`resolveModelChainForRoute`, above) correctly
 * wants by-name resolution for chat (the route's live, admin-configurable current
 * version); knowledge ingestion needs the opposite guarantee — a collection/
 * generation pinned a SPECIFIC immutable version at configuration/build time, and
 * changing what a route's "current" version is afterward must never silently change
 * which model an in-flight or already-built generation used. Throws if the version
 * id doesn't resolve (a referential-integrity problem, not a "fall back to env
 * default" situation — an explicit pin that can't be found is a real error).
 */
export async function resolveModelChainForRouteVersion(ctx: TenantContext, routeVersionId: string): Promise<ResolvedRouteChain> {
  const version = await getRouteVersion(ctx, routeVersionId);
  if (!version) throw new Error(`resolveModelChainForRouteVersion: route version ${routeVersionId} not found`);
  return resolveChainFromVersion(ctx, `route-version:${routeVersionId}`, version);
}

function promptHashFor(system: string | undefined, messages: ChatMessage[]): string {
  return createHash("sha256").update(JSON.stringify({ system, messages })).digest("hex");
}

async function logUsage(
  ctx: TenantContext,
  args: { agentRunId?: string; routeKey: string; resolved: ResolvedRouteChain; latencyMs: number; outcome: "Success" | "ProviderError" | "CacheHit"; errorCode?: string; cached?: boolean },
): Promise<void> {
  const hop0 = args.resolved.hopAttribution[0];
  await insertUsageEvent(ctx, {
    agentRunId: args.agentRunId,
    routeVersionId: args.resolved.routeVersionId ?? undefined,
    catalogEntryId: hop0?.catalogEntryId,
    providerId: hop0?.providerId,
    routeKey: args.routeKey,
    providerKey: args.resolved.chain[0]?.providerKey ?? "unknown",
    model: args.resolved.chain[0]?.model ?? "unknown",
    cached: args.cached ?? false,
    cacheKind: args.cached ? "Exact" : "None",
    latencyMs: args.latencyMs,
    outcome: args.outcome,
    errorCode: args.errorCode,
  });
}

/** Plain-text completion through the full Model Gateway (route resolution + region
 * filter + exact-match cache + usage-event log). */
export async function callModelGatewayText(ctx: TenantContext, args: { routeKey: string; system?: string; messages: ChatMessage[]; agentRunId?: string }): Promise<string> {
  const resolved = await resolveModelChainForRoute(ctx, args.routeKey);
  const promptHash = promptHashFor(args.system, args.messages);

  if (resolved.cacheMode === "ExactMatch") {
    const cached = await getCacheEntry(ctx, args.routeKey, promptHash);
    if (cached && cached.expiresAt.getTime() > Date.now()) {
      await logUsage(ctx, { agentRunId: args.agentRunId, routeKey: args.routeKey, resolved, latencyMs: 0, outcome: "CacheHit", cached: true });
      return (cached.response as { text: string }).text;
    }
  }

  const started = Date.now();
  try {
    const text = await generateText({ routeKey: args.routeKey, system: args.system, messages: args.messages, chain: resolved.chain, totalTimeoutMs: resolved.totalTimeoutMs });
    await logUsage(ctx, { agentRunId: args.agentRunId, routeKey: args.routeKey, resolved, latencyMs: Date.now() - started, outcome: "Success" });
    if (resolved.cacheMode === "ExactMatch") {
      await upsertCacheEntry(ctx, { routeKey: args.routeKey, promptHash, response: { text }, tokensSaved: 0, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    }
    return text;
  } catch (err) {
    await logUsage(ctx, { agentRunId: args.agentRunId, routeKey: args.routeKey, resolved, latencyMs: Date.now() - started, outcome: "ProviderError", errorCode: (err as Error).message.slice(0, 200) });
    throw err;
  }
}

/** Structured-output completion through the full Model Gateway. */
export async function callModelGatewayStructured<S extends TSchema>(
  ctx: TenantContext,
  args: { routeKey: string; schema: S; system: string; messages: ChatMessage[]; agentRunId?: string },
): Promise<Static<S>> {
  const resolved = await resolveModelChainForRoute(ctx, args.routeKey);
  const promptHash = promptHashFor(args.system, args.messages);

  if (resolved.cacheMode === "ExactMatch") {
    const cached = await getCacheEntry(ctx, args.routeKey, promptHash);
    if (cached && cached.expiresAt.getTime() > Date.now()) {
      await logUsage(ctx, { agentRunId: args.agentRunId, routeKey: args.routeKey, resolved, latencyMs: 0, outcome: "CacheHit", cached: true });
      return (cached.response as { value: Static<S> }).value;
    }
  }

  const started = Date.now();
  try {
    const value = await generateStructured({ routeKey: args.routeKey, schema: args.schema, system: args.system, messages: args.messages, chain: resolved.chain, totalTimeoutMs: resolved.totalTimeoutMs });
    await logUsage(ctx, { agentRunId: args.agentRunId, routeKey: args.routeKey, resolved, latencyMs: Date.now() - started, outcome: "Success" });
    if (resolved.cacheMode === "ExactMatch") {
      await upsertCacheEntry(ctx, { routeKey: args.routeKey, promptHash, response: { value }, tokensSaved: 0, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    }
    return value;
  } catch (err) {
    await logUsage(ctx, { agentRunId: args.agentRunId, routeKey: args.routeKey, resolved, latencyMs: Date.now() - started, outcome: "ProviderError", errorCode: (err as Error).message.slice(0, 200) });
    throw err;
  }
}

/** Structured-output completion pinned to an EXACT `model_route_version` id (Phase
 *  7b's ingestion Extract stage) rather than resolved by route name — see
 *  `resolveModelChainForRouteVersion`'s doc comment for why this distinction matters
 *  for FR-KB-03's immutable-pin guarantee. `knowledgeGenerationId` attributes the
 *  resulting `model_usage_event` row to the generation this call ran for. */
export async function callModelGatewayStructuredPinned<S extends TSchema>(
  ctx: TenantContext,
  args: { routeVersionId: string; routeKeyForLog: string; schema: S; system: string; messages: ChatMessage[]; agentRunId?: string; knowledgeGenerationId?: string },
): Promise<Static<S>> {
  const resolved = await resolveModelChainForRouteVersion(ctx, args.routeVersionId);
  const started = Date.now();
  try {
    const value = await generateStructured({ routeKey: args.routeKeyForLog, schema: args.schema, system: args.system, messages: args.messages, chain: resolved.chain, totalTimeoutMs: resolved.totalTimeoutMs });
    await insertUsageEvent(ctx, {
      agentRunId: args.agentRunId,
      routeVersionId: resolved.routeVersionId ?? undefined,
      catalogEntryId: resolved.hopAttribution[0]?.catalogEntryId,
      providerId: resolved.hopAttribution[0]?.providerId,
      routeKey: args.routeKeyForLog,
      providerKey: resolved.chain[0]?.providerKey ?? "unknown",
      model: resolved.chain[0]?.model ?? "unknown",
      outcome: "Success",
      latencyMs: Date.now() - started,
      knowledgeGenerationId: args.knowledgeGenerationId,
    });
    return value;
  } catch (err) {
    await insertUsageEvent(ctx, {
      agentRunId: args.agentRunId,
      routeVersionId: resolved.routeVersionId ?? undefined,
      catalogEntryId: resolved.hopAttribution[0]?.catalogEntryId,
      providerId: resolved.hopAttribution[0]?.providerId,
      routeKey: args.routeKeyForLog,
      providerKey: resolved.chain[0]?.providerKey ?? "unknown",
      model: resolved.chain[0]?.model ?? "unknown",
      outcome: "ProviderError",
      latencyMs: Date.now() - started,
      errorCode: (err as Error).message.slice(0, 200),
      knowledgeGenerationId: args.knowledgeGenerationId,
    });
    throw err;
  }
}

/**
 * Target Architecture Blueprint Phase 7b — the Model Gateway's first embedding call
 * path. Before this phase, `@nextbot/ai-registry`'s `embed()` (which DOES support
 * embeddings, per-provider, at the transport layer) was never wrapped by
 * `@nextbot/model-gateway` — no route-by-name/by-version resolution, no usage-event
 * logging, no caching existed above it. This wraps it exactly like
 * `callModelGatewayText`/`callModelGatewayStructuredPinned`: resolves the pinned
 * route version, calls through, and logs a real `model_usage_event` row (no cost/
 * caching for embeddings this phase — disclosed, matches this phase's own scope: an
 * ingestion embedding call is not a hot conversational path needing exact-match
 * caching the way a chat completion is).
 */
export async function callModelGatewayEmbedding(
  ctx: TenantContext,
  args: { routeVersionId: string; routeKeyForLog: string; input: string; agentRunId?: string; knowledgeGenerationId?: string },
): Promise<{ embedding: number[]; catalogEntryId: string | undefined; providerId: string | undefined }> {
  const resolved = await resolveModelChainForRouteVersion(ctx, args.routeVersionId);
  const started = Date.now();
  try {
    const embedding = await embed({ routeKey: args.routeKeyForLog, input: args.input, chain: resolved.chain, totalTimeoutMs: resolved.totalTimeoutMs });
    await insertUsageEvent(ctx, {
      agentRunId: args.agentRunId,
      routeVersionId: resolved.routeVersionId ?? undefined,
      catalogEntryId: resolved.hopAttribution[0]?.catalogEntryId,
      providerId: resolved.hopAttribution[0]?.providerId,
      routeKey: args.routeKeyForLog,
      providerKey: resolved.chain[0]?.providerKey ?? "unknown",
      model: resolved.chain[0]?.model ?? "unknown",
      outcome: "Success",
      latencyMs: Date.now() - started,
      knowledgeGenerationId: args.knowledgeGenerationId,
    });
    return { embedding, catalogEntryId: resolved.hopAttribution[0]?.catalogEntryId, providerId: resolved.hopAttribution[0]?.providerId };
  } catch (err) {
    await insertUsageEvent(ctx, {
      agentRunId: args.agentRunId,
      routeVersionId: resolved.routeVersionId ?? undefined,
      catalogEntryId: resolved.hopAttribution[0]?.catalogEntryId,
      providerId: resolved.hopAttribution[0]?.providerId,
      routeKey: args.routeKeyForLog,
      providerKey: resolved.chain[0]?.providerKey ?? "unknown",
      model: resolved.chain[0]?.model ?? "unknown",
      outcome: "ProviderError",
      latencyMs: Date.now() - started,
      errorCode: (err as Error).message.slice(0, 200),
      knowledgeGenerationId: args.knowledgeGenerationId,
    });
    throw err;
  }
}

function periodStart(period: "Day" | "Month"): Date {
  const now = new Date();
  return period === "Day" ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** BE3 (unchanged behavior from the pre-Phase-2 implementation, moved here) — a
 * `HardStop` budget genuinely blocks the call; `Throttle`/`AlertOnly` remain minimal
 * (same disclosed scope trim as before Phase 2). */
export async function enforceModelBudget(ctx: TenantContext, input: { agentDefinitionId: string }): Promise<void> {
  const budgets = await listApplicableModelBudgets(ctx, input.agentDefinitionId);
  for (const budget of budgets) {
    const usage = await sumModelUsageCostSince(ctx, { since: periodStart(budget.period), agentDefinitionId: budget.scope === "Agent" ? input.agentDefinitionId : undefined });
    if (usage >= Number(budget.capUsd) && budget.onExceed === "HardStop") {
      throw new ModelBudgetExceededError(budget.scope);
    }
  }
}
