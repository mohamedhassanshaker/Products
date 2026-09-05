import { AllProvidersUnavailableError } from "@nextbot/contracts";
import { getProviderClient } from "./providers/index.js";
import type { ChatMessage, ProviderCallResult } from "./providers/types.js";
import { ProviderCallError } from "./providers/types.js";
import { loadAiRegistryEnv, requestTimeoutMs, resolveEnvModelId, totalTimeoutMs, type LogicalModelName } from "./config.js";

/** A single resolved entry in a provider fallback chain — already resolved to a
 * concrete provider/model/endpoint/credential, never a logical name or a
 * `model_route` row (that resolution is `packages/modules/agent-platform`'s job,
 * LLD §7.1: "sits on top of this registry"). */
export interface ResolvedChainEntry {
  providerKey: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  maxTokens?: number;
  /** Per-attempt timeout for this entry specifically; falls back to
   * `AI_REQUEST_TIMEOUT_MS` when absent. */
  timeoutMs?: number;
}

/** LLD §7.1 "env default" resolution tier — used when no tenant/platform
 * `model_route` row exists for a logical name at all. A single-entry chain built
 * entirely from env config. */
export function resolveModel(logicalName: LogicalModelName): ResolvedChainEntry {
  const env = loadAiRegistryEnv();
  return {
    providerKey: env.AI_PROVIDER,
    model: resolveEnvModelId(logicalName),
    baseUrl: env.AI_BASE_URL,
    apiKey: env.AI_API_KEY,
  };
}

const RETRYABLE_BACKOFF_BASE_MS = 200;

function jitteredBackoff(attempt: number): number {
  return RETRYABLE_BACKOFF_BASE_MS * attempt + Math.floor(Math.random() * 100);
}

/**
 * ADR-0006 §2.3 fallback/retry engine, factored out so both `generateText`/
 * `generateStructured` (text-producing) and `embed` share one implementation of:
 * per-attempt timeout, one same-provider retry on a retryable failure (429/5xx/
 * network reset — never on a 4xx client error, which will not succeed on retry),
 * then advance to the next chain entry; a **30s ceiling across the whole chain**
 * (`totalTimeoutMs`, FR-AGT-08) regardless of how many entries/retries that spans.
 *
 * @throws {AllProvidersUnavailableError} once every entry (and its one retry) has
 * failed, or the total-timeout budget is exhausted before a call succeeds.
 */
export async function executeChain<T>(
  chain: ResolvedChainEntry[],
  routeKeyForError: string,
  attempt: (entry: ResolvedChainEntry, timeoutMs: number) => Promise<T>,
  totalTimeoutMsOverride?: number,
): Promise<T> {
  if (chain.length === 0) {
    throw new AllProvidersUnavailableError(routeKeyForError);
  }
  const deadline = Date.now() + (totalTimeoutMsOverride ?? totalTimeoutMs());

  for (const entry of chain) {
    for (let retry = 0; retry <= 1; retry++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new AllProvidersUnavailableError(routeKeyForError);
      }
      const perAttemptTimeout = Math.max(1, Math.min(entry.timeoutMs ?? requestTimeoutMs(), remaining));
      try {
        return await attempt(entry, perAttemptTimeout);
      } catch (cause) {
        const retryable = cause instanceof ProviderCallError ? cause.retryable : true;
        if (!retryable || retry === 1) break; // advance to the next chain entry (or exhaust)
        await new Promise((resolve) => setTimeout(resolve, Math.min(jitteredBackoff(retry + 1), Math.max(0, deadline - Date.now()))));
      }
    }
  }
  throw new AllProvidersUnavailableError(routeKeyForError);
}

export async function generateTextOverChain(
  chain: ResolvedChainEntry[],
  routeKeyForError: string,
  request: { system?: string; messages: ChatMessage[]; jsonSchema?: Record<string, unknown> },
  totalTimeoutMsOverride?: number,
): Promise<ProviderCallResult & { providerKey: string; model: string }> {
  return executeChain(
    chain,
    routeKeyForError,
    async (entry, timeoutMs) => {
      const client = getProviderClient(entry.providerKey);
      const result = await client.generateText({
        model: entry.model,
        baseUrl: entry.baseUrl,
        apiKey: entry.apiKey,
        system: request.system,
        messages: request.messages,
        maxTokens: entry.maxTokens,
        jsonSchema: request.jsonSchema,
        timeoutMs,
      });
      return { ...result, providerKey: entry.providerKey, model: entry.model };
    },
    totalTimeoutMsOverride,
  );
}
