import { Type, type Static } from '@sinclair/typebox';

/** Tenant lifecycle status. */
export const TenantStatusSchema = Type.Union([Type.Literal('active'), Type.Literal('paused')]);

/** Create-tenant body (FR-TENANT-1). Status is optional and defaults to active. */
export const CreateTenantRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 80 }),
  slug: Type.String({ minLength: 2, maxLength: 48 }),
  status: Type.Optional(TenantStatusSchema),
});

/** Create-tenant request. */
export type CreateTenantRequest = Static<typeof CreateTenantRequestSchema>;

/** Patch-tenant body — name only; slug in the body is rejected in the use case. */
export const UpdateTenantRequestSchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    slug: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/** Update-tenant request. */
export type UpdateTenantRequest = Static<typeof UpdateTenantRequestSchema>;

/** Pause / activate body (FR-TENANT-4). */
export const ChangeTenantStatusRequestSchema = Type.Object({
  status: TenantStatusSchema,
});

/** Status-change request. */
export type ChangeTenantStatusRequest = Static<typeof ChangeTenantStatusRequestSchema>;

/** Tenant resource as returned by create/get/patch/status. */
export const TenantSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  slug: Type.String(),
  status: TenantStatusSchema,
  room_namespace: Type.String(),
  created_at: Type.String(),
  updated_at: Type.String(),
});

/** Tenant DTO. */
export type TenantDto = Static<typeof TenantSchema>;

/** Screen 3 list row (FR-TENANT-2). */
export const TenantListItemSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  slug: Type.String(),
  status: TenantStatusSchema,
  provider_stack_summary: Type.String(),
  updated_at: Type.String(),
});

/** Tenant list item DTO. */
export type TenantListItemDto = Static<typeof TenantListItemSchema>;

/** List query (FR-TENANT-2). page_size > 100 is rejected in the use case so the
 *  TypeBox pipe can still accept the raw query and return PAGE_SIZE_INVALID. */
export const ListTenantsQuerySchema = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 80 })),
  status: Type.Optional(TenantStatusSchema),
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  page_size: Type.Optional(Type.Integer({ minimum: 1, default: 25 })),
});

/** List-tenants query. */
export type ListTenantsQuery = Static<typeof ListTenantsQuerySchema>;
