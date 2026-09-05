import type { ErrorCode } from '@examland/contracts';

/**
 * Base class for every application-thrown error — ported verbatim from
 * `legacy/api/src/common/errors/domain-error.ts` (LLD §12.3: "application code throws `DomainError`
 * subclasses carrying an `ErrorCode`; only the HTTP boundary maps to a status code"). This app has no
 * Route Handlers/global exception filter yet (deferred alongside `auth`/the `api/` surface in a later
 * Phase 1 sub-dispatch), but every domain module built this dispatch (tenants, provisioning) already
 * throws these — so callers can `instanceof`-narrow them today, and whichever later dispatch adds the
 * HTTP boundary maps `error.code` via `@examland/contracts`' already-total `ERROR_CODE_HTTP_STATUS`
 * without this class needing to change shape.
 *
 * No plain `server/common/` module-boundary ESLint rule is added for this file (or its siblings under
 * `util/`) — mirrors the legacy app's own convention: `common/` is shared-kernel, stateless, pure code
 * with no resource to protect (no DataSource, no singleton, no I/O chokepoint), so the module-boundary
 * rule (which exists to stop a caller from bypassing a barrel that owns real state) doesn't apply.
 */
export class DomainError extends Error {
  /**
   * @param code Machine-readable {@link ErrorCode}; must have a corresponding entry in
   *   `ERROR_CODE_HTTP_STATUS` (compile-time enforced in `@examland/contracts`).
   * @param message Safe-to-display message (NFR-5 equivalent) — never a raw driver/ORM error string.
   * @param details Optional structured detail matching the code's documented `details` shape.
   */
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
    // Restores the prototype chain lost when extending a built-in (Error) under some transpilation
    // targets, so `instanceof DomainError` keeps working after being thrown/caught across module
    // boundaries — ported verbatim from the legacy base class for the identical reason.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Generic validation failure — used by {@link import('../../platform/provisioning').TenantProvisioningService}
 * for the one input (`adminEmail`) this dispatch's scope doesn't have a dedicated `ErrorCode`/DTO
 * validation layer for yet (no `class-validator`/API layer exists this dispatch). */
export class ValidationFailedError extends DomainError {
  constructor(fields: { field: string; constraint: string }[]) {
    super('VALIDATION_FAILED', 'One or more fields failed validation.', { fields });
  }
}

/**
 * The four generic, cross-cutting `DomainError` subclasses every realm's auth/authorization surface
 * needs (Phase 1 sub-slice 1b) — ported verbatim from `legacy/api/src/common/errors/domain-error.ts`.
 * Kept in this shared-kernel file (not a module-specific `domain/errors.ts`) because they are thrown
 * from multiple, otherwise-unrelated modules (`context/with-tenant-context`, `context/with-platform-
 * auth`, `auth`, `rbac`, `platform/auth`) — duplicating them per-module would let their messages/codes
 * drift, which is exactly what `DomainError` centralization exists to prevent.
 */

/** Generic not-found error for a resource with no dedicated `ErrorCode` yet (e.g. `GET /auth/me` for a
 * user row that vanished between token issuance and this request). */
export class NotFoundDomainError extends DomainError {
  constructor(message = 'The requested resource was not found.') {
    super('NOT_FOUND', message);
  }
}

/** Thrown when a request has no valid credentials at all (distinct from wrong credentials) — the
 * single error every realm's bearer-token check throws on a missing/malformed/invalid/expired/
 * wrong-realm/wrong-tenant token (LLD-equivalent: every distinct rejection reason collapses to this
 * one code so a client can never distinguish "expired" from "wrong tenant" from "malformed"). */
export class UnauthenticatedError extends DomainError {
  constructor(message = 'Authentication is required to access this resource.') {
    super('UNAUTHENTICATED', message);
  }
}

/** Thrown when an authenticated principal is not permitted to perform the requested action (RBAC
 * deny-path). */
export class ForbiddenDomainError extends DomainError {
  constructor(message = 'You are not permitted to perform this action.') {
    super('FORBIDDEN', message);
  }
}

/**
 * Thrown for truly unexpected failures, and also for the handful of "should be structurally
 * unreachable" defensive assertions ported verbatim from legacy (e.g. "called outside any resolved
 * tenant scope") — the caller's own bug, never a client-facing condition, so the client only ever
 * sees the generic message below; the real `cause` is logged server-side only.
 */
export class InternalDomainError extends DomainError {
  constructor(public readonly cause?: unknown) {
    super('INTERNAL_ERROR', 'An unexpected error occurred. Please try again later.');
  }
}
