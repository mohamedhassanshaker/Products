/**
 * `npm run provision-demo-tenant` (via `tsx`) — this app's equivalent of
 * `legacy/api/src/seed-demo-tenant.ts`, adapted to this dispatch's DI-container-free composition
 * roots. Exists for the identical reason: a fresh platform schema has zero tenant rows, and there is
 * no HTTP/auth layer yet in this app (a later Phase 1 sub-dispatch) through which to drive
 * provisioning any other way — this script is also this dispatch's own exit-gate proof that the full
 * provisioning workflow works end-to-end against real MySQL (`docs/plans/nextjs-rewrite-phase1-
 * plan.md`'s exit gate item 5).
 *
 * **Idempotent by design**: checks `PlatformTenantRepository.existsBySlug` first and exits without
 * calling `provisionNewTenant` at all if the slug is already taken (including by a soft-deleted
 * tenant — that repository method's own documented semantics).
 *
 * Env vars read directly via `process.env` (not `getEnv()`) — a one-off local-dev/verification
 * convenience, matching legacy's identical precedent for this exact script:
 *   - `DEMO_TENANT_NAME` (default `"Demo Next"`)
 *   - `DEMO_TENANT_SUBDOMAIN` (default `"demo-next"` — deliberately distinct from legacy's own
 *     `seed-demo-tenant.ts` default of `"demo"`, since both scripts can target the same physical
 *     MySQL server during this migration's transition period and a colliding slug would make this
 *     script's `existsBySlug` idempotency check silently no-op against a tenant *legacy* created)
 *   - `DEMO_TENANT_ADMIN_EMAIL` (default `"admin@demo-next.local"`)
 *
 * Run via (see docs/plans/nextjs-rewrite-phase1-plan.md for the exact env vars used against the
 * shared dev MySQL container):
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     npm run provision-demo-tenant -w apps/next
 */
import { getPlatformDataSource } from '@/server/infrastructure/database';
import { getTenantsService } from '@/server/platform/tenants';
import { getTenantProvisioningService } from '@/server/platform/provisioning';
import type { ProvisionNewTenantInput } from '@/server/platform/provisioning';

/** Resolves this script's three target-tenant inputs from `process.env`. */
export function resolveDemoTenantInput(): ProvisionNewTenantInput {
  const name = process.env.DEMO_TENANT_NAME?.trim() || 'Demo Next';
  const subdomainSlug = process.env.DEMO_TENANT_SUBDOMAIN?.trim().toLowerCase() || 'demo-next';
  const adminEmail = process.env.DEMO_TENANT_ADMIN_EMAIL?.trim() || 'admin@demo-next.local';
  return { name, subdomainSlug, adminEmail };
}

async function bootstrap(): Promise<void> {
  const input = resolveDemoTenantInput();
  const tenantsService = await getTenantsService();
  const provisioning = await getTenantProvisioningService();

  // eslint-disable-next-line no-console -- CLI script's own user-facing output, not application logging.
  console.log(JSON.stringify({ status: 'starting', subdomainSlug: input.subdomainSlug }));

  // `TenantsService` has no direct `existsBySlug` passthrough (that lives on the repository this
  // dispatch keeps module-internal) — attempting `create()` and catching `SubdomainTakenError` would
  // work too, but listing first via `get`-adjacent read is unnecessary here since
  // `provisionNewTenant` already surfaces `SubdomainTakenError` identically; this script simply lets
  // that error signal "already exists" rather than duplicating the existence check.
  try {
    const tenant = await provisioning.provisionNewTenant(input);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ status: tenant.status, id: tenant.id, subdomainSlug: tenant.subdomainSlug }, null, 2));
    process.exitCode = 0;
  } catch (err) {
    const code = (err as { code?: string } | undefined)?.code;
    if (code === 'SUBDOMAIN_TAKEN') {
      const list = await tenantsService.list({ includeDeleted: true, pageSize: 100 });
      const existing = list.items.find((t) => t.subdomainSlug === input.subdomainSlug);
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          { status: 'already-exists', subdomainSlug: input.subdomainSlug, id: existing?.id ?? null, tenantStatus: existing?.status },
          null,
          2,
        ),
      );
      process.exitCode = 0;
      return;
    }
    // eslint-disable-next-line no-console
    console.error('Fatal error running provision-demo-tenant:', err);
    process.exitCode = 1;
    throw err;
  }
}

bootstrap()
  .catch(() => {
    process.exitCode = 1;
  })
  .finally(async () => {
    // This script's process would otherwise never exit: the platform `DataSource`'s pool keeps at
    // least one open TCP connection alive, and Node only exits once the event loop is empty. No
    // NestJS `app.close()` lifecycle hook exists in this DI-container-free app to do this
    // automatically (legacy's identical `seed-demo-tenant.ts` gets this for free from
    // `app.close()`) — explicit teardown here is this app's equivalent.
    try {
      const ds = await getPlatformDataSource();
      await ds.destroy();
    } catch {
      // Best-effort — a failure tearing down the pool must not mask this script's real exit code.
    }
    process.exit(process.exitCode ?? 0);
  });
