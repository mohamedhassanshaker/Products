import { SetMetadata } from '@nestjs/common';

/** Metadata key for required roles. */
export const ROLES_KEY = 'roles';

/**
 * Restricts a handler to the listed roles (any-of).
 * @param roles - `operator` and/or `admin`
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
