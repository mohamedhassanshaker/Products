/**
 * RFC 9457 (`application/problem+json`) responses for `/api/public/v1/*`
 * (api.md §2.1). This is the first real HTTP JSON error surface in
 * `shj3-web` — every prior route on this surface (the `(backoffice)` screens)
 * is a Server Action returning an `ActionResult<T>` discriminated union, not
 * an HTTP problem document — so this file is a genuinely new, small,
 * self-contained implementation of the shape api.md §2 defines, scoped to
 * this module's own routes rather than a shared platform-wide serialiser
 * (out of this module's touch scope to build one).
 *
 * `_lib/` is a leading-underscore convention: Next.js's App Router only
 * treats `route.ts`/`page.tsx`/etc. as routable, so this directory (and every
 * other `_lib` under `app/api/public/v1/`) is invisible to routing and exists
 * purely to share code between the real route handlers.
 */

import { randomBytes } from "node:crypto";
import { newUlid } from "../../../../../modules/platform/adapters/outbound/sql/ulid.js";

export interface FieldError {
  readonly pointer?: string;
  readonly parameter?: string;
  readonly code: string;
  readonly detail: string;
  readonly meta?: Record<string, unknown>;
}

export interface ProblemInput {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail?: string;
  readonly traceId: string;
  readonly instance?: string;
  readonly errors?: readonly FieldError[];
  readonly meta?: Record<string, unknown>;
}

/** `req_<ulid>` — matches api.md §2.1's own worked example shape (`"req_01JBQ7X2K9"`). */
export function newRequestId(now: Date = new Date()): string {
  return `req_${newUlid(now)}`;
}

/**
 * A W3C-shaped 32-hex fallback trace id for the rare case an error is raised
 * *before* `AuthMiddleware` ever bound one (a forged-tenant rejection, which
 * `assertNoTenantOverride` throws before `traceId` is computed — see
 * `auth-middleware.ts`'s own `handle()`/`handleAnonymous()` ordering).
 */
export function newFallbackTraceId(): string {
  return randomBytes(16).toString("hex");
}

export function problemResponse(input: ProblemInput, requestId: string): Response {
  const body: Record<string, unknown> = {
    type: `https://api.shj3.gov.ae/problems/${input.code}`,
    title: input.title,
    status: input.status,
    code: input.code,
    traceId: input.traceId,
    requestId,
    timestamp: new Date().toISOString(),
  };
  if (input.detail !== undefined) body.detail = input.detail;
  if (input.instance !== undefined) body.instance = input.instance;
  if (input.errors !== undefined) body.errors = input.errors;
  if (input.meta !== undefined) body.meta = input.meta;

  return new Response(JSON.stringify(body), {
    status: input.status,
    headers: {
      "content-type": "application/problem+json",
      "x-request-id": requestId,
    },
  });
}

/**
 * A duck-typed shape every domain/application error in this module implements
 * (`readonly code: string; readonly status: number`) — never a class
 * hierarchy import, since these errors are raised across module boundaries
 * (`modules/conversation/application/*`, `modules/iam`'s `UnauthenticatedError`,
 * `platform/adapters/outbound/ai-client.ts`'s `AiServiceError`) and duck-typing
 * is what lets one mapper handle all of them without this file importing
 * every one of their classes just to `instanceof`-check.
 */
interface CodedError {
  readonly code: string;
  readonly status: number;
  readonly message?: string;
}

function isCodedError(error: unknown): error is CodedError {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

/**
 * Map any caught error to a problem response. api.md §2.2's forbidden-content
 * table is enforced structurally here: only `error.code`/`error.status` (both
 * closed, developer-authored values on this module's own error classes) and a
 * generic title are used — never `error.message` for an *unrecognised* error,
 * which could carry a stack trace, a SQL fragment, or vendor text.
 *
 * Recognised errors (this module's own domain/application classes, plus
 * `UnauthenticatedError`/`AiServiceError`) DO surface their own `.message` as
 * `detail`, because every one of those messages is hand-written, reviewed
 * prose with no interpolated untrusted/internal data (confirmed by reading
 * each class directly) — never an exception's raw text.
 */
export function errorToProblem(error: unknown, traceId: string, instance: string): ProblemInput {
  if (error instanceof ValidationFailedProblem) {
    return {
      status: 422,
      code: "validation.failed",
      title: "Request validation failed",
      detail: `${error.errors.length} field(s) failed validation.`,
      traceId,
      instance,
      errors: error.errors,
    };
  }

  if (isCodedError(error)) {
    return {
      status: error.status,
      code: error.code,
      title: titleCase(error.code),
      traceId,
      instance,
      // `exactOptionalPropertyTypes`: `error.message` is `string | undefined`
      // (every `Error` subclass's own field), and `ProblemInput.detail` may
      // be omitted or a real `string` but never `undefined` explicitly.
      ...(error.message !== undefined ? { detail: error.message } : {}),
    };
  }

  console.error("[public-v1] unhandled error", { traceId, instance, error });
  return {
    status: 500,
    code: "internal.error",
    title: "Internal error",
    traceId,
    instance,
  };
}

/** A marker class routes can throw with a pre-shaped `errors[]` array (api.md §2.1) — kept here, not in `modules/conversation`, since it is purely a wire-shape concern. */
export class ValidationFailedProblem extends Error {
  constructor(readonly errors: readonly FieldError[]) {
    super(`${errors.length} field(s) failed validation.`);
    this.name = "ValidationFailedProblem";
  }
}

function titleCase(code: string): string {
  const reason = code.split(".").pop() ?? code;
  return reason
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
