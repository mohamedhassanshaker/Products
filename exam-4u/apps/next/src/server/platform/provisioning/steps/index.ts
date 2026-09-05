import type { PackageRepository, TenantSubscriptionRepository } from '@/server/platform/billing';
import type { EmailPort, ProvisioningStep } from '@/server/tenancy';
import { CreateSchemaStep } from './create-schema.step';
import { RunMigrationsStep } from './run-migrations.step';
import { SeedRbacStep } from './seed-rbac.step';
import { SeedAdminUserStep } from './seed-admin-user.step';
import { CreateSubscriptionStep } from './create-subscription.step';
import { InviteAdminStep } from './invite-admin.step';

export { CreateSchemaStep, RunMigrationsStep, SeedRbacStep, SeedAdminUserStep, CreateSubscriptionStep, InviteAdminStep };

/**
 * Builds the fixed, ordered `ProvisioningStep[]` array (HLD §4.4's exact sequence: `create_schema ->
 * run_migrations -> seed_rbac -> seed_admin_user -> create_subscription -> invite_admin`, matching
 * `@examland/contracts`' `PROVISIONING_STEP_ORDER`). Ported from legacy's `PROVISIONING_STEPS` DI
 * token + `steps/index.ts` factory-provider pattern, collapsed into one plain function since this app
 * has no DI container to register providers with — `TenantProvisioningService`'s composition root
 * (`../index.ts`) calls this once and passes the resulting array into the service's constructor,
 * which is what makes a test able to override it with a partially-fake sequence (pass a hand-built
 * array instead of calling this factory) without touching the service's own source.
 */
export function createProvisioningSteps(deps: {
  packages: PackageRepository;
  subscriptions: TenantSubscriptionRepository;
  emailPort: EmailPort;
}): ProvisioningStep[] {
  return [
    new CreateSchemaStep(),
    new RunMigrationsStep(),
    new SeedRbacStep(),
    new SeedAdminUserStep(),
    new CreateSubscriptionStep(deps.packages, deps.subscriptions),
    new InviteAdminStep(deps.emailPort),
  ];
}
