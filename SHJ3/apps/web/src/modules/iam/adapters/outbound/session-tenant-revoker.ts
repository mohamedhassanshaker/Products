/**
 * The `iam`-side implementation of `TenantSessionRevoker` (`modules/platform/ports/
 * provisioning.ts`) — the seam `SuspendTenant` uses to end every live session for a
 * tenant without `platform` importing `iam` directly (architecture.md §3).
 *
 * Rebinds `runWithTenant` to the target tenant for the call's duration — `SessionStore`
 * has no tenant parameter of its own (`destroyAllForTenant()`'s own doc comment: it
 * reads the ambient binding, same as every other method on that interface), so this is
 * the only way to operate on a tenant other than the one the calling platform operator's
 * own session is bound to. No `platformScope` needed: `SessionStore` only ever reaches
 * `getTenantCache()`, which has no scope gate (unlike `getPlatformDb()`).
 */

import { randomUUID } from "node:crypto";
import { runWithTenant } from "../../../platform/tenancy/tenant-context.js";
import type { TenantSlug } from "../../../platform/tenancy/tenant-slug.js";
import type { TenantSessionRevoker } from "../../../platform/ports/provisioning.js";
import type { SessionStore } from "../../ports/session-store.js";

export class SessionStoreTenantRevoker implements TenantSessionRevoker {
  constructor(private readonly sessions: SessionStore) {}

  async destroyAllSessions(tenant: TenantSlug): Promise<number> {
    return runWithTenant(
      { tenant, principal: null, traceId: randomUUID().replace(/-/g, "") },
      () => this.sessions.destroyAllForTenant(),
    );
  }
}
