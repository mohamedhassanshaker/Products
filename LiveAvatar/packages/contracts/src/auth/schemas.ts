import { Type, type Static } from '@sinclair/typebox';

/** Email + password login body (FR-AUTH-1). Email is trimmed at the pipe. */
export const LoginRequestSchema = Type.Object({
  email: Type.String({ minLength: 1, maxLength: 254 }),
  password: Type.String({ minLength: 1, maxLength: 128 }),
});

/** Login request. */
export type LoginRequest = Static<typeof LoginRequestSchema>;

/** Refresh-token rotation body (FR-AUTH-2). */
export const RefreshRequestSchema = Type.Object({
  refresh_token: Type.String({ minLength: 1 }),
});

/** Refresh request. */
export type RefreshRequest = Static<typeof RefreshRequestSchema>;

/** Logout body — refresh token identifies the family to revoke. */
export const LogoutRequestSchema = Type.Object({
  refresh_token: Type.String({ minLength: 1 }),
});

/** Logout request. */
export type LogoutRequest = Static<typeof LogoutRequestSchema>;

/** One-time operator bootstrap (FR-AUTH-3). */
export const SeedRequestSchema = Type.Object({
  email: Type.String({ minLength: 1, maxLength: 254 }),
  password: Type.String({ minLength: 8, maxLength: 128 }),
});

/** Seed request. */
export type SeedRequest = Static<typeof SeedRequestSchema>;

/** Admin role keys. */
export const RoleSchema = Type.Union([Type.Literal('operator'), Type.Literal('admin')]);

/** Public admin identity returned after login /me. */
export const AdminUserSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  email: Type.String(),
  roles: Type.Array(RoleSchema),
  tenant_ids: Type.Array(Type.String({ format: 'uuid' })),
});

/** Admin user DTO. */
export type AdminUserDto = Static<typeof AdminUserSchema>;

/** Successful login / accept-invite session payload. */
export const TokenPairSchema = Type.Object({
  access_token: Type.String(),
  expires_in: Type.Literal(28800),
  refresh_token: Type.String(),
  user: AdminUserSchema,
});

/** Token pair DTO. */
export type TokenPairDto = Static<typeof TokenPairSchema>;

/** Refresh success (user omitted). */
export const RefreshResponseSchema = Type.Object({
  access_token: Type.String(),
  expires_in: Type.Integer(),
  refresh_token: Type.String(),
});

/** Create-invite body. */
export const CreateInviteRequestSchema = Type.Object({
  email: Type.String({ minLength: 1, maxLength: 254 }),
  roles: Type.Array(RoleSchema, { minItems: 1 }),
  tenant_ids: Type.Array(Type.String({ format: 'uuid' })),
});

/** Create-invite request. */
export type CreateInviteRequest = Static<typeof CreateInviteRequestSchema>;

/** Invite accept body (FR-AUTH-3). */
export const AcceptInviteRequestSchema = Type.Object({
  token: Type.String({ minLength: 1 }),
  password: Type.String({ minLength: 8, maxLength: 128 }),
});

/** Accept-invite request. */
export type AcceptInviteRequest = Static<typeof AcceptInviteRequestSchema>;

/** Invite list item. */
export const InviteItemSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  email: Type.String(),
  roles: Type.Array(RoleSchema),
  tenant_ids: Type.Array(Type.String()),
  expires_at: Type.String(),
  accepted_at: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
});

/** Invite item DTO. */
export type InviteItemDto = Static<typeof InviteItemSchema>;

/** Create-invite success — token is the v1 out-of-band channel (no email yet). */
export const CreateInviteResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  email: Type.String(),
  roles: Type.Array(RoleSchema),
  tenant_ids: Type.Array(Type.String()),
  expires_at: Type.String(),
  invite_token: Type.String(),
});

/** Create-invite response. */
export type CreateInviteResponse = Static<typeof CreateInviteResponseSchema>;
