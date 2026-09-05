/** Public API of the tenants module. */
export { TenantsModule } from './tenants.module';
export { TENANT_REPOSITORY } from './domain/ports';
export type { TenantRepositoryPort } from './domain/ports';
export type { TenantRecord } from './domain/tenant';
export { TENANT_LIMIT, SLUG_RE } from './domain/tenant';
