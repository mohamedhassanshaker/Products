/**
 * The internal provider-client interface (LLD §7.1). Every file under `providers/` (the
 * only place a provider SDK may be imported, per dependency-cruiser's
 * `no-provider-sdk-outside-ai-registry` rule) implements this shape; nothing above the
 * registry ever sees a provider-specific type.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderCallParams {
  model: string;
  baseUrl?: string;
  /** Resolved plaintext API key for this call (decrypted by the caller from the vault
   * or read from `AI_API_KEY` — providers/** never touches `SecretsProvider` directly,
   * keeping this package DB/vault-agnostic per LLD §2.2). */
  apiKey?: string;
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  /** A JSON Schema (compiled from TypeBox by `structured.ts`) to request as the
   * provider's native structured-output format. Absent for a plain text completion. */
  jsonSchema?: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface ProviderCallResult {
  /** Raw text content, or the raw JSON string when `jsonSchema` was requested — parsed
   * and `Value.Check`-validated by `structured.ts`, never by a provider adapter. */
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export interface EmbedParams {
  model: string;
  baseUrl?: string;
  apiKey?: string;
  input: string;
  timeoutMs: number;
}

export interface EmbedResult {
  embedding: number[];
  tokensIn: number;
}

/** Thrown by a provider adapter for any transport/HTTP-level failure (network error,
 * non-2xx, malformed response) or a client-side timeout — the registry's fallback-chain
 * logic (`registry.ts`) catches this specifically to decide retry-same vs.
 * advance-to-next-provider vs. give up. Never thrown for a schema-validation failure
 * (that's `StructuredOutputInvalidError`, raised by `structured.ts` after the provider
 * call already succeeded at the transport level). */
export class ProviderCallError extends Error {
  constructor(
    message: string,
    readonly kind: "Timeout" | "RateLimited" | "ServerError" | "ClientError" | "NetworkError",
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderCallError";
  }
}

export interface ModelProviderClient {
  generateText(params: ProviderCallParams): Promise<ProviderCallResult>;
  embed(params: EmbedParams): Promise<EmbedResult>;
}
