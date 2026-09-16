/**
 * The compound gate for the platform operator's own console (Part B of the
 * platform-admin wave).
 *
 * Two independent conditions, both required:
 *
 *  1. `"platform:operate"` is present in the principal's permission set. This
 *     string is also appended to iam's own closed `PERMISSIONS` catalog
 *     (`modules/iam/domain/permissions.ts`) so B9 tab 3 can display and grant
 *     it like any other permission — but this file checks the raw string
 *     against `Principal.permissions` directly rather than importing that
 *     catalog, because `platform` depends on nothing (architecture.md §3) and
 *     `iam` is a feature module.
 *  2. The principal's own tenant is the real Platform tenant — read via
 *     `TenantProfileReader.isPlatformTenant()`, backed by `TenantProfiles.
 *     isPlatformTenant`, the same ambient, tenant-scoped flag
 *     `sql-store-provisioner.ts`'s `ensureTenantProfile` seeds from
 *     `platform.Tenants.entityKind` at provisioning time and
 *     `TR_Teams_crossEntityScope` already trusts.
 *
 * Checking only the permission would not be a real boundary: B9 tab 3 lets any
 * tenant's own EntityAdmin/SuperAdmin toggle any matrix cell for their own
 * tenant at runtime, so the permission alone could in principle be
 * self-granted inside e.g. SEWA's own `RolePermissions` table. The
 * tenant-identity half is the actual security boundary — `platform:operate`
 * is deliberately never added to the shared `SEEDED_ROLE_PERMISSIONS` seed, so
 * the only tenant whose `RolePermissions` table can legitimately carry it is
 * the Platform tenant's own — but both halves must ship together, which is
 * why this throws on either failing rather than exposing two separate checks
 * a caller could call only one of.
 *
 * A class with injected deps, not a bare function, unlike `requirePermission`
 * (`iam/application/require-permission.ts`) — that file is pure (it only reads
 * an in-memory `Principal`), this one needs a DB read, so it follows this
 * codebase's own port+adapter convention for testability (architecture.md §4)
 * instead of forcing a bare function to hide I/O. It still mirrors
 * `requirePermission`'s throw-not-boolean shape: a boolean can be ignored, a
 * thrown error cannot.
 */

import type { Principal } from "../tenancy/tenant-context.js";
import type { TenantProfileReader } from "../ports/tenant-profile-reader.js";

const PLATFORM_OPERATE_PERMISSION = "platform:operate";

export class PlatformOperatorDeniedError extends Error {
  constructor(readonly operation: string) {
    super(`"${operation}" requires the platform operator's own tenant and the platform:operate permission.`);
    this.name = "PlatformOperatorDeniedError";
  }
}

export interface RequirePlatformOperatorDeps {
  readonly tenantProfile: TenantProfileReader;
}

export class RequirePlatformOperator {
  constructor(private readonly deps: RequirePlatformOperatorDeps) {}

  /** Throws `PlatformOperatorDeniedError` unless both conditions above hold. */
  async execute(principal: Principal, operation: string): Promise<void> {
    if (!principal.permissions.has(PLATFORM_OPERATE_PERMISSION)) {
      throw new PlatformOperatorDeniedError(operation);
    }

    const isPlatformTenant = await this.deps.tenantProfile.isPlatformTenant();
    if (!isPlatformTenant) {
      throw new PlatformOperatorDeniedError(operation);
    }
  }
}
