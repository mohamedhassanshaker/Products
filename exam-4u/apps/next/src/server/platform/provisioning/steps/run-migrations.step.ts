import type { ProvisioningStepName } from '@examland/contracts';
import { createTenantDataSource } from '@/server/infrastructure/database';
import type { ProvisioningContext, ProvisioningStep } from '@/server/tenancy';

/**
 * HLD §4.4 step 2 / LLD §8.2: "`run_migrations` uses a **short-lived** `DataSource` (not the request
 * registry) so provisioning never consumes a resident slot" — ported verbatim from
 * `legacy/api/src/tenancy/provisioning/steps/run-migrations.step.ts`. Builds a brand-new `DataSource`
 * via {@link createTenantDataSource} (the same factory the pooled registry uses internally), runs
 * every pending tenant migration, then destroys it immediately.
 *
 * Idempotent by construction: TypeORM's own migrations table already tracks which migrations have
 * applied, so re-running this step after a later step failed is a no-op once the schema is already
 * at the latest tenant migration.
 */
export class RunMigrationsStep implements ProvisioningStep {
  readonly name: ProvisioningStepName = 'run_migrations';

  async run(ctx: ProvisioningContext): Promise<void> {
    const dataSource = await createTenantDataSource(ctx.tenant.schemaName);
    try {
      await dataSource.runMigrations();
    } finally {
      await dataSource.destroy();
    }
  }
}
