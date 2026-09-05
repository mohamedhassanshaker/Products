import { HttpErrorResponse } from '@angular/common/http';
import { AppErrorCode, ERROR_CODES, messageForCode } from '@liveavatar/contracts';

/**
 * Non-spec codes the client adds for transport failures that never reached
 * the API (or reached it but returned a body that isn't the LLD §5.1 envelope).
 */
export type ClientErrorCode = AppErrorCode | 'NETWORK_ERROR' | 'UNKNOWN_ERROR';

/** Normalized shape every feature switches on (LLD §9.1: switch on code, never message strings). */
export interface AppClientError {
  status: number;
  code: ClientErrorCode;
  message: string;
  details: Record<string, unknown>;
}

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

/** Narrows an unknown value to a known {@link AppErrorCode}. */
export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && ERROR_CODE_SET.has(value);
}

/**
 * Parses an Angular `HttpErrorResponse` into an {@link AppClientError}.
 * - status 0 (no response reached the client, e.g. offline/CORS) → `NETWORK_ERROR`.
 * - A body matching the LLD §5.1 envelope with a known code → that code, with
 *   the server's `message` preferred over the local map (server is authoritative).
 * - Anything else (5xx with no envelope, malformed body) → `UNKNOWN_ERROR`.
 */
export function toAppClientError(error: HttpErrorResponse): AppClientError {
  if (error.status === 0) {
    return { status: 0, code: 'NETWORK_ERROR', message: 'Network error.', details: {} };
  }

  const body = error.error as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null;
  const rawCode = body?.error?.code;

  if (isAppErrorCode(rawCode)) {
    const details =
      body?.error?.details && typeof body.error.details === 'object'
        ? (body.error.details as Record<string, unknown>)
        : {};
    const message = typeof body?.error?.message === 'string' ? body.error.message : messageForCode(rawCode);
    return { status: error.status, code: rawCode, message, details };
  }

  return {
    status: error.status,
    code: 'UNKNOWN_ERROR',
    message: 'An unexpected error occurred.',
    details: {},
  };
}
