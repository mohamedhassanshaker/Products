import type { TenantRecord } from '../domain/tenant';

/**
 * Maps the domain tenant record to the API's snake_case DTO (LLD §5.3).
 * @param record - Domain tenant
 */
export function toTenantDto(record: TenantRecord) {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    status: record.status,
    room_namespace: record.roomNamespace,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

/**
 * Maps a domain tenant record to the Screen 3 list row (LLD §5.3).
 * @param record - Domain tenant
 */
export function toTenantListItemDto(record: TenantRecord) {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    status: record.status,
    provider_stack_summary: record.providerStackSummary,
    updated_at: record.updatedAt.toISOString(),
  };
}
