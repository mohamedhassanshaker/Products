import { AppError } from '../../../common/errors/app-error';
import { SLUG_RE } from './tenant';

/**
 * Validates tenant name (FR-TENANT-1).
 * @param name - Raw name
 * @returns Trimmed name
 */
export function assertTenantName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) {
    throw AppError.badRequest('TENANT_NAME_INVALID', {
      fields: { name: 'TENANT_NAME_INVALID' },
    });
  }
  return trimmed;
}

/**
 * Validates tenant slug (FR-TENANT-1).
 * @param slug - Raw slug
 * @returns Slug unchanged when valid
 */
export function assertTenantSlug(slug: string): string {
  if (!SLUG_RE.test(slug)) {
    throw AppError.badRequest('TENANT_SLUG_INVALID', {
      fields: { slug: 'TENANT_SLUG_INVALID' },
    });
  }
  return slug;
}

/**
 * Validates a pause/activate status transition body (FR-TENANT-4).
 * @param status - Raw status value
 * @returns Status unchanged when valid
 */
export function assertTenantStatus(status: unknown): 'active' | 'paused' {
  if (status !== 'active' && status !== 'paused') {
    throw AppError.badRequest('TENANT_STATUS_INVALID');
  }
  return status;
}
