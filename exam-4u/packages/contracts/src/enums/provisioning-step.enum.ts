/**
 * The fixed, ordered set of steps `TenantProvisioningService` executes to take a tenant from
 * `Provisioning` to `Active` (HLD §4.4, LLD §4 `tenant_provisioning_step.step` column). Order here
 * is documentation only — the actual execution order is the array in
 * `apps/api/src/tenancy/provisioning/steps/index.ts`; both must match the LLD-specified sequence
 * `create_schema -> run_migrations -> seed_rbac -> seed_admin_user -> create_subscription ->
 * invite_admin`.
 */
export type ProvisioningStepName =
  | 'create_schema'
  | 'run_migrations'
  | 'seed_rbac'
  | 'seed_admin_user'
  | 'create_subscription'
  | 'invite_admin';

/** Per-step ledger status (LLD §4 `tenant_provisioning_step.status` column). */
export type ProvisioningStepStatus = 'Pending' | 'Running' | 'Completed' | 'Failed';

/** Fixed execution order — the single source of truth other code/tests can import instead of
 * re-typing the literal sequence. */
export const PROVISIONING_STEP_ORDER: readonly ProvisioningStepName[] = [
  'create_schema',
  'run_migrations',
  'seed_rbac',
  'seed_admin_user',
  'create_subscription',
  'invite_admin',
];
