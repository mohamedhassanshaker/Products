/**
 * List every tenant regardless of status — the platform operator's Tenants screen
 * (Part C of the platform-admin wave). Read-only: no audit entry, mirroring
 * `AuditSink`'s own doc comment ("a listing is not a write").
 */

import type { Tenant } from "../domain/tenant.js";
import type { TenantRegistry } from "../ports/provisioning.js";

export interface ListTenantsDeps {
  readonly registry: TenantRegistry;
}

export class ListTenants {
  constructor(private readonly deps: ListTenantsDeps) {}

  async execute(): Promise<readonly Tenant[]> {
    return this.deps.registry.listAll();
  }
}
