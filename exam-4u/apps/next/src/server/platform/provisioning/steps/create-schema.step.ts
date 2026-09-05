import type { ProvisioningStepName } from '@examland/contracts';
import { getEnv } from '@/server/config';
import { ensureSchemaExists } from '@/server/infrastructure/database';
import type { ProvisioningContext, ProvisioningStep } from '@/server/tenancy';

/**
 * HLD §4.4 step 1: `CREATE DATABASE IF NOT EXISTS \`t_...\` CHARACTER SET utf8mb4` — ported verbatim
 * from `legacy/api/src/tenancy/provisioning/steps/create-schema.step.ts`. Reuses the exact same
 * {@link ensureSchemaExists} helper the platform schema's own boot-time self-creation could use —
 * the documented idempotent primitive provisioning steps rely on, not a second implementation of the
 * same DDL.
 */
export class CreateSchemaStep implements ProvisioningStep {
  readonly name: ProvisioningStepName = 'create_schema';

  async run(ctx: ProvisioningContext): Promise<void> {
    const env = getEnv();
    await ensureSchemaExists({
      host: env.DB_HOST ?? '127.0.0.1',
      port: env.DB_PORT,
      user: env.DB_USER ?? 'root',
      password: env.DB_PASSWORD,
      schema: ctx.tenant.schemaName,
    });
  }
}
