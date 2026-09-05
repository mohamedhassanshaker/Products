import { type AppErrorCode, messageForCode } from '@liveavatar/contracts';

/**
 * Domain/application error. The HTTP filter maps `httpStatus` + `code` into
 * the LLD error envelope. Never leak stacks through this type.
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  readonly details: Record<string, unknown>;

  /**
   * @param code - Closed contract code
   * @param httpStatus - Spec status (400/401/403/404/409/422/429/503)
   * @param details - Optional field-level or validation list
   * @param messageOverride - Rare; defaults to the contract sentence
   */
  constructor(
    code: AppErrorCode,
    httpStatus: number,
    details: Record<string, unknown> = {},
    messageOverride?: string,
  ) {
    super(messageOverride ?? messageForCode(code));
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }

  /** Builds a 400 with optional field map. */
  static badRequest(code: AppErrorCode, details: Record<string, unknown> = {}): AppError {
    return new AppError(code, 400, details);
  }

  /** Builds a 401 unauthenticated error. */
  static unauthorized(code: AppErrorCode = 'AUTH_UNAUTHORIZED'): AppError {
    return new AppError(code, 401);
  }

  /** Builds a 403 forbidden error. */
  static forbidden(code: AppErrorCode): AppError {
    return new AppError(code, 403);
  }

  /** Builds a 404 not-found error. */
  static notFound(code: AppErrorCode): AppError {
    return new AppError(code, 404);
  }

  /** Builds a 409 conflict error. */
  static conflict(code: AppErrorCode, details: Record<string, unknown> = {}): AppError {
    return new AppError(code, 409, details);
  }

  /** Builds a 429 rate-limit error. */
  static tooMany(code: AppErrorCode): AppError {
    return new AppError(code, 429);
  }
}

/**
 * Server defect: a tenant-scoped Prisma query ran without a tenant filter.
 * FR-TENANT-5 — must become 500, never a client 403/404.
 */
export class TenantScopeViolationError extends Error {
  constructor(model: string) {
    super(`Tenant-scoped query on ${model} is missing tenant_id`);
    this.name = 'TenantScopeViolationError';
  }
}
