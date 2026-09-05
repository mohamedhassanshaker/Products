/**
 * `npm run provision-phase3-demo-tenant` (via `tsx`) — provisions a fresh demo tenant through the
 * real `TenantProvisioningService` workflow (`scripts/provision-demo-tenant.ts`'s own established
 * pattern) **and** additionally sets a known password directly on the invited Tenant Admin, so this
 * dispatch's own real-browser Playwright smoke script (`scripts/playwright-smoke-tenant.ts`) has
 * someone to log in as.
 *
 * **Why this is needed and not a shortcut around real auth**: the real provisioning workflow's
 * `invite_admin` step deliberately leaves the invited Tenant Admin's `password_hash NULL` — production
 * correctly requires the real password-recovery flow to activate an invited account. There is no way
 * to log in as that Tenant Admin through the UI without either driving the forgot-password flow and
 * intercepting the `NoopEmailAdapter`'s logged reset link, or setting a password directly for
 * verification purposes. This script does the latter, explicitly matching the migration plan's own
 * already-endorsed Phase 10 seed-script deviation ("seed a Tenant Admin with a known password set
 * directly... documented, intentional deviation from production's invite-only flow — justified because
 * this... stack is for immediate local/e2e login"). The Tenant Admin still authenticates through the
 * real `POST /api/auth/login` -> real bcrypt compare -> real JWT issuance afterward, exactly as any real
 * user would — only the *initial* password-setting step is a verification convenience, not a bypass of
 * any auth code path.
 *
 * Env vars (all optional, matching `provision-demo-tenant.ts`'s own convention):
 *   - `DEMO_TENANT_NAME` (default `"Demo Phase 3"`)
 *   - `DEMO_TENANT_SUBDOMAIN` (default `"demo-phase3"`)
 *   - `DEMO_TENANT_ADMIN_EMAIL` (default `"admin@demo-phase3.local"`)
 *   - `DEMO_TENANT_ADMIN_PASSWORD` (default `"Phase3-Demo-Pass-1"`)
 *
 * Run via:
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     npm run provision-phase3-demo-tenant -w apps/next
 */
import { getEnv } from '@/server/config';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { getTenantProvisioningService, type ProvisionNewTenantInput } from '@/server/platform/provisioning';
import { runWithRequestContext } from '@/server/context';
import { UserRepository } from '@/server/auth';
import { BcryptPasswordHasherAdapter } from '@/server/infrastructure/security';
import { randomUUID } from 'node:crypto';

function resolveInput(): ProvisionNewTenantInput & { adminPassword: string } {
  const name = process.env.DEMO_TENANT_NAME?.trim() || 'Demo Phase 3';
  const subdomainSlug = process.env.DEMO_TENANT_SUBDOMAIN?.trim().toLowerCase() || 'demo-phase3';
  const adminEmail = process.env.DEMO_TENANT_ADMIN_EMAIL?.trim() || 'admin@demo-phase3.local';
  const adminPassword = process.env.DEMO_TENANT_ADMIN_PASSWORD?.trim() || 'Phase3-Demo-Pass-1';
  return { name, subdomainSlug, adminEmail, adminPassword };
}

async function bootstrap(): Promise<void> {
  const input = resolveInput();
  const env = getEnv();
  const provisioning = await getTenantProvisioningService();

  // eslint-disable-next-line no-console -- CLI script's own user-facing output, not application logging.
  console.log(JSON.stringify({ status: 'starting', subdomainSlug: input.subdomainSlug }));

  try {
    const tenant = await provisioning.provisionNewTenant(input);

    if (tenant.status === 'Active') {
      // Set a known password directly on the invited admin — see this file's own doc comment for why
      // this is a verification convenience, not an auth bypass.
      const registry = getTenantDataSourceRegistry();
      const dataSource = await registry.acquire(tenant.schemaName);
      try {
        await runWithRequestContext(
          { requestId: randomUUID(), tenantId: tenant.id, tenantSlug: tenant.subdomainSlug, tenantSchema: tenant.schemaName, tenantDataSource: dataSource },
          async () => {
            const users = new UserRepository(dataSource);
            const admin = await users.findByEmail(input.adminEmail);
            if (!admin) throw new Error(`Invited admin ${input.adminEmail} not found after provisioning.`);
            const hasher = new BcryptPasswordHasherAdapter(env.BCRYPT_COST);
            await users.setPasswordHash(admin.id, await hasher.hash(input.adminPassword));
          },
        );
      } finally {
        registry.release(tenant.schemaName);
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        { status: tenant.status, id: tenant.id, subdomainSlug: tenant.subdomainSlug, adminEmail: input.adminEmail, adminPasswordSet: tenant.status === 'Active' },
        null,
        2,
      ),
    );
    process.exitCode = 0;
  } catch (err) {
    const code = (err as { code?: string } | undefined)?.code;
    if (code === 'SUBDOMAIN_TAKEN') {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ status: 'already-exists', subdomainSlug: input.subdomainSlug }));
      process.exitCode = 0;
    } else {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exitCode = 1;
    }
  } finally {
    const platformDs = await getPlatformDataSource();
    await getTenantDataSourceRegistry().destroyAll();
    await platformDs.destroy();
  }
}

bootstrap();
