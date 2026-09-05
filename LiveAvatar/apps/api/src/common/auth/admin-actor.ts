/** Authenticated admin principal attached to the request by AdminJwtGuard. */
export interface AdminActor {
  id: string;
  email: string;
  roles: string[];
  tenantIds: string[];
}

/**
 * True when the actor holds the operator role (JWT tenant_ids empty = all tenants).
 * @param actor - Current admin
 */
export function isOperator(actor: AdminActor): boolean {
  return actor.roles.includes('operator');
}

/**
 * True when the actor may see/mutate the given tenant.
 * Operators always; admins only when assigned.
 * @param actor - Current admin
 * @param tenantId - Target tenant
 */
export function canAccessTenant(actor: AdminActor, tenantId: string): boolean {
  if (isOperator(actor)) {
    return true;
  }
  return actor.tenantIds.includes(tenantId);
}
