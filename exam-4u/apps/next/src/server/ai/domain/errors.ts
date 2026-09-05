import { DomainError } from '@/server/common/errors/domain-error';

/**
 * `AI_ENABLED=false` — every AI operation fails closed with this, with NO override flag, ported
 * verbatim (behavior contract) from `legacy/api/src/ai/domain/errors.ts`'s `AiDisabledError`. Thrown
 * by `AiService` before any socket is ever opened.
 */
export class AiDisabledError extends DomainError {
  constructor() {
    super('AI_DISABLED', 'AI is disabled for this deployment.');
  }
}

/**
 * Transport/availability failure: connection refused/DNS/socket hangup/timeout, a `5xx`/`429`
 * response after retries, a genuine auth/config failure classified as non-retryable, or an open
 * circuit breaker. Distinct from `AiProviderFailedError` — this means "we could not reach/use the
 * model", not "the model ran and produced a content failure".
 */
export class AiServiceUnavailableError extends DomainError {
  /**
   * @param nonRetryable Set by `AiService` for the "our bug/config" branch (401/403/400 HTTP
   *   responses from OpenRouter) — the retry loop checks this to stop immediately rather than burning
   *   the remaining attempts on a misconfiguration that will never succeed.
   */
  constructor(
    message = 'The AI service is temporarily unavailable. Please try again shortly.',
    public readonly nonRetryable = false,
  ) {
    super('AI_SERVICE_UNAVAILABLE', message);
  }
}

/** "The model produced a content failure we chose to surface" — e.g. a schema-invalid output a
 * caller decided was fatal rather than a droppable item. Never thrown for a transport/availability
 * failure (see {@link AiServiceUnavailableError}). */
export class AiProviderFailedError extends DomainError {
  constructor(message = 'The AI provider could not produce a usable result.') {
    super('AI_PROVIDER_FAILED', message);
  }
}

/** A model response failed the boundary zod schema (the contract-drift alarm) — mapped to the same
 * client-facing behavior as a generic provider failure but logged distinctly server-side
 * (`ai.contract_violation`) by `AiService` before this is thrown. */
export class AiContractViolationError extends DomainError {
  constructor(operation: string) {
    super('AI_PROVIDER_FAILED', `The AI model's response for "${operation}" did not match the expected contract.`);
  }
}
