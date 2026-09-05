/**
 * Client-side mirror of `@examland/contracts`' `ErrorEnvelope`/`ErrorCode` shape — deliberately a
 * local type, not re-imported from `@/server/**` (this app's client bundle never imports server-only
 * modules). Mirrors `lib/platform-console/api-error.ts`'s identical shape/rationale, duplicated here
 * rather than shared because the two realms' client bundles are deliberately independent (the tenant
 * realm must never accidentally pull in a platform-only import, and vice versa).
 */
export interface TenantApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId: string;
  timestamp: string;
}

/** Thrown by every `tenant-console` API call on a non-2xx response — carries the parsed
 * `ErrorEnvelope.error` body plus the HTTP status, so a caller can branch on `error.code`
 * (`TAXONOMY_ENTRY_IN_USE`, `NOT_CURRICULUM_OWNER`, ...) without re-parsing the response itself. */
export class TenantApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TenantApiError';
  }
}

/** Type guard — narrows a caught `unknown` (e.g. from a `.catch`/`catch` block) to
 * {@link TenantApiError} so a component can safely read `.code`/`.status`. */
export function isTenantApiError(error: unknown): error is TenantApiError {
  return error instanceof TenantApiError;
}
