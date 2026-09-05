/** Tenant aggregate as the application layer sees it. */
export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'paused';
  roomNamespace: string;
  createdAt: Date;
  updatedAt: Date;
  providerStackSummary: string;
}

/** Maximum tenants per platform instance (FR-TENANT-1). */
export const TENANT_LIMIT = 500;

/** Slug: 2–48 chars, starts with a letter, lowercase / digits / hyphens. */
export const SLUG_RE = /^[a-z][a-z0-9-]{1,47}$/;
