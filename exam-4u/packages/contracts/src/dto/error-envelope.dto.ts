import type { ErrorCode } from '../error-codes';

/**
 * The shape of the `details` object for a `VALIDATION_FAILED` error (LLD §13.1): one entry per
 * invalid field, naming the field and the constraint it violated.
 */
export interface ValidationFieldError {
  field: string;
  constraint: string;
}

/**
 * The single, non-2xx HTTP response body shape used everywhere in the system (LLD §13.1). Produced
 * exclusively by `AllExceptionsFilter` in `apps/api` — no handler constructs this by hand.
 */
export interface ErrorEnvelope {
  error: {
    /** Machine-readable code from the shared {@link ErrorCode} union. */
    code: ErrorCode;
    /** Safe to display to the end user as-is (NFR-5): specific enough to act on, never a raw stack/driver message. */
    message: string;
    /** Optional, code-specific structured detail (e.g. `{ fields: ValidationFieldError[] }` for `VALIDATION_FAILED`). */
    details?: Record<string, unknown>;
    /** Echoes `X-Request-Id` (or a generated one) so a client-reported error can be located in server logs. */
    requestId: string;
    /** ISO-8601 UTC timestamp of when the error was produced. */
    timestamp: string;
  };
}
