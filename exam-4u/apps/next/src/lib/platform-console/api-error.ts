/**
 * Client-side mirror of `@examland/contracts`' `ErrorEnvelope`/`ErrorCode` shape — deliberately a
 * local type, not re-imported from `@/server/**` (this app's client bundle never imports server-only
 * modules; the legacy Angular app's own `core/errors/api-error.ts` established the identical
 * "the frontend HTTP client owns its own error-shape mirror" convention this file follows).
 */
export interface PlatformApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId: string;
  timestamp: string;
}

/** Thrown by every `platform-console` API call on a non-2xx response — carries the parsed
 * `ErrorEnvelope.error` body plus the HTTP status, so a caller can branch on `error.code`
 * (`INVALID_TENANT_STATE`, `SUBDOMAIN_TAKEN`, ...) without re-parsing the response itself. */
export class PlatformApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PlatformApiError';
  }
}

/** Type guard — narrows a caught `unknown` (e.g. from a `.catch`/`catch` block) to
 * {@link PlatformApiError} so a component can safely read `.code`/`.status`. */
export function isPlatformApiError(error: unknown): error is PlatformApiError {
  return error instanceof PlatformApiError;
}
