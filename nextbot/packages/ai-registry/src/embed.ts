import { AllProvidersUnavailableError } from "@nextbot/contracts";
import { getProviderClient } from "./providers/index.js";
import { ProviderCallError } from "./providers/types.js";
import { requestTimeoutMs, totalTimeoutMs, type LogicalModelName } from "./config.js";
import { resolveModel, type ResolvedChainEntry } from "./registry.js";

/** LLD §7.1 `embed.knowledge` logical name — used for KB retrieval and the semantic
 * response cache. Shares the same chain-resolution shape as `generateText`/
 * `generateStructured` but is embeddings-specific (no schema, no structured output). */
export async function embed(args: { routeKey?: string; input: string; chain?: ResolvedChainEntry[]; totalTimeoutMs?: number }): Promise<number[]> {
  const chain = args.chain ?? [resolveModel((args.routeKey ?? "embed.knowledge") as LogicalModelName)];
  const deadline = Date.now() + (args.totalTimeoutMs ?? totalTimeoutMs());
  let lastError: unknown;
  for (const entry of chain) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const client = getProviderClient(entry.providerKey);
      const result = await client.embed({
        model: entry.model,
        baseUrl: entry.baseUrl,
        apiKey: entry.apiKey,
        input: args.input,
        timeoutMs: Math.max(1, Math.min(entry.timeoutMs ?? requestTimeoutMs(), remaining)),
      });
      return result.embedding;
    } catch (cause) {
      lastError = cause;
      if (cause instanceof ProviderCallError && !cause.retryable) continue;
    }
  }
  throw lastError instanceof Error ? lastError : new AllProvidersUnavailableError(args.routeKey ?? "embed.knowledge");
}
