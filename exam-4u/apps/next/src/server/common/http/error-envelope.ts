import { NextResponse } from 'next/server';
import { ERROR_CODE_HTTP_STATUS, type ErrorCode, type ErrorEnvelope } from '@examland/contracts';
import { logger } from '@/server/logging';
import { DomainError } from '@/server/common/errors/domain-error';

/**
 * Shared exception-to-HTTP-response translation for every Route Handler in this app — the Next.js
 * equivalent of legacy's `ErrorResponseWriter`/`AllExceptionsFilter` chokepoint (LLD §12.3: "only the
 * HTTP boundary maps a `DomainError` to a status code"). Ported logic (not code — no Express
 * `Request`/`Response`, no Nest `HttpException`/`BadRequestException`/`PayloadTooLargeException`
 * special-casing since this app has no class-validator/multer equivalent yet) from
 * `legacy/api/src/common/errors/error-response-writer.ts`.
 *
 * Used from three places this dispatch: `middleware.ts` (tenant-resolution rejections),
 * `context/with-tenant-context.ts`/`context/with-platform-auth.ts` (any `DomainError` a wrapped
 * handler throws), so every realm's Route Handlers get the identical envelope shape/logging
 * discipline without each one hand-rolling its own try/catch.
 */

/** Resolves any thrown value to the `{status, code, message, details}` shape the envelope needs.
 * Kept pure (no I/O, no logging) so it's directly unit-testable. */
export function resolveError(exception: unknown): {
  status: number;
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
} {
  if (exception instanceof DomainError) {
    return {
      status: ERROR_CODE_HTTP_STATUS[exception.code],
      code: exception.code,
      message: exception.message,
      details: exception.details,
    };
  }

  // Unknown/unexpected — never leak internals (a raw ORM/driver message, a stack trace) to the client.
  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred. Please try again later.',
  };
}

/**
 * Resolves `exception`, logs exactly one line (`error` for a 5xx, `warn` otherwise — matching
 * legacy's identical severity split), and returns the finished `NextResponse` carrying the
 * `ErrorEnvelope` body. Callers return this value directly as their Route Handler's response.
 *
 * @param exception Whatever was thrown/caught.
 * @param requestId Echoed into the envelope's `requestId` field (`X-Request-Id` header if the caller
 *   already resolved one, else a generated UUID) — lets a client-reported error be located in server
 *   logs, matching legacy's `ErrorEnvelope.requestId` contract.
 * @param routeLabel Optional `"METHOD /path"` label for the log line only (never sent to the client).
 */
export function toErrorResponse(exception: unknown, requestId: string, routeLabel?: string): NextResponse {
  const { status, code, message, details } = resolveError(exception);

  const envelope: ErrorEnvelope = {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      requestId,
      timestamp: new Date().toISOString(),
    },
  };

  const logPayload = { requestId, route: routeLabel, statusCode: status, errorCode: code };
  if (status >= 500) {
    logger.error({ ...logPayload, err: exception instanceof Error ? exception : new Error(String(exception)) }, 'http.request_failed');
  } else {
    logger.warn(logPayload, 'http.request_rejected');
  }

  return NextResponse.json(envelope, { status });
}
