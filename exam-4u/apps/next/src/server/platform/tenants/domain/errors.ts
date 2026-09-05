import { DomainError } from '@/server/common/errors/domain-error';

/** FR-MT-1: "Required inputs at creation: tenant name (non-empty)...". Ported verbatim from
 * `legacy/api/src/platform/tenants/domain/errors.ts`. */
export class TenantNameRequiredError extends DomainError {
  constructor() {
    super('TENANT_NAME_REQUIRED', 'Tenant name is required.');
  }
}

/**
 * FR-MT-1: "a subdomain violating the character set or already in use is rejected with a specific
 * `INVALID_SUBDOMAIN` / `SUBDOMAIN_TAKEN` error respectively". Also thrown for a reserved subdomain
 * (`admin`, `www`, `api`, ...) — deliberately the *same* code as a character-set violation.
 */
export class InvalidSubdomainError extends DomainError {
  constructor() {
    super(
      'INVALID_SUBDOMAIN',
      'Subdomain must be 1-63 lowercase alphanumeric characters and hyphens (no leading/trailing/' +
        'consecutive hyphens), and may not be a reserved name.',
    );
  }
}

/** FR-MT-1: subdomain uniqueness violation — "unique platform-wide, immutable once set". */
export class SubdomainTakenError extends DomainError {
  constructor() {
    super('SUBDOMAIN_TAKEN', 'This subdomain is already in use.');
  }
}

/** Thrown when a tenant id does not resolve to any row in `platform.tenant`. A soft-deleted tenant is
 * still findable by id via `TenantsService.get()` during its retention window. */
export class TenantNotFoundError extends DomainError {
  constructor() {
    super('TENANT_NOT_FOUND', 'No such tenant.');
  }
}

/**
 * Thrown by a lifecycle transition (`suspend`/`reactivate`/`softDelete`/provisioning `retry`)
 * attempted from a status that doesn't support it — e.g. suspending an already-`Suspended` tenant.
 * `INVALID_TENANT_STATE` is the 409 (conflict) "you can't do that from here" state-machine-violation
 * code.
 */
export class InvalidTenantStateError extends DomainError {
  constructor(message: string) {
    super('INVALID_TENANT_STATE', message);
  }
}

/** FR-MT-10 / LLD §9.11 — a client-supplied accent-color string isn't exactly 6 hex digits (after
 * stripping an optional leading `#`). Ported verbatim from `legacy/api/src/platform/tenants/domain/errors.ts`. */
export class InvalidColorFormatError extends DomainError {
  constructor() {
    super('INVALID_COLOR_FORMAT', 'Color must be a 6-digit hex value, e.g. "#3949AB" or "3949AB".');
  }
}

/**
 * FR-MT-10 / LLD §9.11: the candidate accent color's contrast ratio against the worse of the two
 * published surface anchors fell below the WCAG 2.2 AA non-text minimum. `details` names the exact
 * computed ratio, the required minimum, and which surface failed — LLD §9.11: "never silently applied
 * or silently clamped", so the client must be told precisely why and by how much. Ported verbatim from
 * `legacy/api/src/platform/tenants/domain/errors.ts`.
 */
export class InsufficientColorContrastError extends DomainError {
  constructor(details: { ratio: number; required: number; failingSurface: 'light' | 'dark' }) {
    super(
      'INSUFFICIENT_COLOR_CONTRAST',
      `This color's contrast ratio is ${details.ratio}:1 against the ${details.failingSurface} surface; ` +
        `at least ${details.required}:1 is required.`,
      details,
    );
  }
}
