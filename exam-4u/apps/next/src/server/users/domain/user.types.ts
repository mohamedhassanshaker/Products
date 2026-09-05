/** A role reference as embedded on a `UserSummary` — every user response includes the resolved role
 * names/`isSystem` flag, not just ids, so a client never needs a second round-trip to render a
 * user's grants — ported verbatim from `legacy/api/src/modules/users/domain/user.types.ts`. */
export interface UserRoleRef {
  id: number;
  name: string;
  isSystem: boolean;
}

/** Full admin-facing read-shape for one user (FR-IAM-7's list/detail surface). Never includes
 * `passwordHash`/reset-token columns. */
export interface UserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  occupation: string | null;
  companyName: string | null;
  country: string | null;
  isActive: boolean;
  roles: UserRoleRef[];
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}

/** Every column `UsersService.list()` accepts as a sort key. Kept as a fixed, narrow enum — never a
 * raw client-supplied column name — so a `sortBy` value can be interpolated into an `ORDER BY`
 * clause safely. */
export type UserSortColumn = 'email' | 'firstName' | 'lastName' | 'createdAt' | 'lastLoginAt';

export interface ListUsersOptions {
  /** Matches (case-insensitively) against email, firstName, or lastName. */
  search?: string;
  sortBy?: UserSortColumn;
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface ListUsersResult {
  items: UserSummary[];
  total: number;
}

/**
 * `UsersService.create()`'s result. `temporaryPassword` is populated **only** when the caller
 * omitted `password` and the server generated one — this is the one and only moment that value is
 * ever returned; it is never retrievable again afterward (only its bcrypt hash is persisted).
 */
export interface CreateUserResult {
  user: UserSummary;
  temporaryPassword?: string;
}
