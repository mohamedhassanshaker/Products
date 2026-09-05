/**
 * `npm run seed` (via `tsx`) — Phase 10 sub-slice "10a" (`docs/plans/nextjs-rewrite-phase10-plan.md`).
 *
 * The one idempotent, `docker compose run --rm web npm run seed` entry point the new
 * `docker-compose.next.yml` stack's operator runs once after `docker compose up -d` to get a
 * genuinely usable local/e2e environment, per the migration plan's "New docker-compose + seed
 * (Phase 10)" section. Six steps, run in order, all safely re-runnable:
 *
 *   1. Run platform migrations (`getPlatformDataSource().runMigrations()`).
 *   2. Seed the package/feature catalog — this is a NO-OP as its own explicit step: the catalog is
 *      already seeded by step 1 itself, because `SeedFeaturePackageCatalog20260815000007` (Phase 1a)
 *      IS a platform migration, not a separate seed mechanism (verified by reading that migration
 *      file directly — every insert is `ON DUPLICATE KEY UPDATE id = id`, i.e. idempotent by
 *      construction). Documented here rather than silently duplicated with a second, redundant
 *      insert path.
 *   3. Seed one Platform Admin via the already-built `runPlatformAdminBootstrap()` (Phase 1b) —
 *      reads `PLATFORM_ADMIN_BOOTSTRAP_EMAIL`/`_PASSWORD` and permanently no-ops once any Platform
 *      Admin row exists.
 *   4. Provision 2-3 demo tenants (one per package tier: starter/pro/enterprise) through the real
 *      `TenantProvisioningService.provisionNewTenant` workflow — real schema creation, real RBAC
 *      seeding (`SeedRbacStep`), real subscription creation (`CreateSubscriptionStep`, which always
 *      targets `FALLBACK_PACKAGE_KEY`/`starter` — see the doc comment on
 *      `resolveDemoTenantPackage` below for how the pro/enterprise tenants are then upgraded).
 *   5. Set a known password directly on each tenant's seeded Tenant Admin user (`seed_admin_user`
 *      leaves `password_hash IS NULL`, since production's real flow is invite-only) — an intentional,
 *      documented deviation from production, justified because this compose stack exists for
 *      immediate local/e2e login, not for modeling the production invite-email flow.
 *   6. **Added by the post-Phase-10-e2e closure dispatch that ports `platform/usage` (FR-PKG-5)**:
 *      reset every `tenant_feature_usage` row belonging to the three demo tenants above. Real
 *      feature-usage-limit enforcement is now live on every gated Route Handler this app has (see
 *      `docs/plans/nextjs-rewrite-phase10-plan.md`'s "Post-e2e closure" section) — clusters 2/4/5/6/7's
 *      own e2e tests repeatedly exercise gated actions (`POST /api/exam-types/zip`, `POST /api/attempts`,
 *      `POST /api/pdf-processing/upload`, `POST /api/curricula/:id/documents`) against these SAME demo
 *      tenants every time the suite runs, so without this step a demo tenant's real, finite quota
 *      (e.g. `demo-starter`'s seeded `exams.create` limit of 5) would eventually be genuinely exhausted
 *      by nothing more than repeated *test* runs, breaking the suite's own re-run-repeatedly guarantee
 *      (Phase 10's own "passed twice in immediate succession with zero flakiness" exit-gate item) — not
 *      a bug in the enforcement engine itself (which is working exactly as designed), but an operational
 *      reality of a shared, real-quota-enforced demo environment. Re-running `npm run seed` before a
 *      fresh e2e pass restores full headroom for every demo tenant, matching this whole script's own
 *      "genuinely usable local/e2e environment" purpose.
 *
 * Idempotency: every step above is safe to run twice in a row with zero duplicate rows and zero
 * duplicate-key errors — proven directly (not just assumed) in
 * `docs/plans/nextjs-rewrite-phase10-plan.md`'s "Verification evidence" section by literally running
 * this script twice against a cold volume and diffing row counts.
 */
import { randomUUID } from 'node:crypto';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { getEnv } from '@/server/config';
import { logger } from '@/server/logging';
import { runPlatformAdminBootstrap } from '@/server/platform/auth';
import { getTenantsService } from '@/server/platform/tenants';
import { getTenantProvisioningService, type ProvisionNewTenantInput } from '@/server/platform/provisioning';
import { getBillingRepositories } from '@/server/platform/billing';
import { BcryptPasswordHasherAdapter } from '@/server/infrastructure/security';
import { runWithRequestContext } from '@/server/context';
import { UserRepository } from '@/server/auth';

/** One seeded demo tenant's fixed shape — deliberately hardcoded, not env-configurable, since this
 * script exists purely to produce a known, documented local/e2e fixture set (unlike
 * `provision-demo-tenant.ts`, which is a single-tenant ad hoc dev convenience). */
interface DemoTenantSpec {
  name: string;
  subdomainSlug: string;
  adminEmail: string;
  /** The catalog package key this demo tenant should end up subscribed to. */
  packageKey: 'starter' | 'pro' | 'enterprise';
}

/** The known password every seeded demo Tenant Admin gets — overridable via
 * `DEMO_TENANT_ADMIN_PASSWORD` (documented in the Phase 10 plan doc), defaulting to a fixed,
 * obviously-non-production value. This is the deliberate "known password set directly" deviation the
 * dispatch's own spec calls for (step 5). */
const DEMO_TENANT_ADMIN_PASSWORD = process.env.DEMO_TENANT_ADMIN_PASSWORD?.trim() || 'Demo123!Pass';

const DEMO_TENANTS: DemoTenantSpec[] = [
  { name: 'Demo Starter Academy', subdomainSlug: 'demo-starter', adminEmail: 'admin@demo-starter.local', packageKey: 'starter' },
  { name: 'Demo Pro Academy', subdomainSlug: 'demo-pro', adminEmail: 'admin@demo-pro.local', packageKey: 'pro' },
  { name: 'Demo Enterprise Academy', subdomainSlug: 'demo-enterprise', adminEmail: 'admin@demo-enterprise.local', packageKey: 'enterprise' },
];

/** Step 1: run every pending platform migration (idempotent — TypeORM's own `migrations` table
 * tracks what already applied). This is also where the feature/package catalog (step 2) actually
 * gets seeded — see this file's own header doc comment. */
async function runPlatformMigrations(): Promise<void> {
  const ds = await getPlatformDataSource();
  const applied = await ds.runMigrations();
  logger.info({ appliedCount: applied.length }, 'seed.platform_migrations_run');
}

/** Step 3: idempotent Platform Admin bootstrap (already-built Phase 1b service — see
 * `PlatformAdminBootstrapService`'s own doc comment for the exact no-op-after-first-admin contract). */
async function seedPlatformAdmin(): Promise<void> {
  await runPlatformAdminBootstrap();
  logger.info({ email: getEnv().PLATFORM_ADMIN_BOOTSTRAP_EMAIL || null }, 'seed.platform_admin_bootstrap_attempted');
}

/**
 * Provisions (or finds, if already provisioned) one demo tenant through the real workflow, then:
 *   - upgrades its subscription to the spec's `packageKey` if it isn't `starter` (the only package
 *     `CreateSubscriptionStep` itself ever assigns — see that step's own doc comment: no
 *     package-choice input exists on `provisionNewTenant` yet, that's a later Phase 2 console feature
 *     layered on top). This reuses the exact same `PackageRepository.findByKey`/
 *     `TenantSubscriptionRepository.upsertForTenant` calls `CreateSubscriptionStep` itself calls —
 *     not a raw insert — so this is still "the real workflow's own write path", just invoked a second
 *     time with a different target package, a documented judgment call given no higher-level API
 *     exists yet to express "provision directly onto package X".
 *   - sets a known password directly on the seeded Tenant Admin (step 5, see file header).
 *
 * Idempotent: `provisionNewTenant` itself surfaces `SUBDOMAIN_TAKEN` on a repeat call (handled below,
 * same pattern as `provision-demo-tenant.ts`); the package-upgrade and password-set calls below are
 * themselves idempotent (`upsertForTenant` is a natural-key upsert; the password UPDATE is
 * unconditional and produces byte-identical state on every run, never a duplicate row).
 */
async function seedDemoTenant(spec: DemoTenantSpec): Promise<{ id: string; schemaName: string; status: string }> {
  const provisioning = await getTenantProvisioningService();
  const tenantsService = await getTenantsService();

  const input: ProvisionNewTenantInput = {
    name: spec.name,
    subdomainSlug: spec.subdomainSlug,
    adminEmail: spec.adminEmail,
  };

  let tenant: { id: string; schemaName: string; status: string };
  try {
    const result = await provisioning.provisionNewTenant(input);
    tenant = { id: result.id, schemaName: result.schemaName, status: result.status };
    logger.info({ subdomainSlug: spec.subdomainSlug, tenantId: tenant.id }, 'seed.demo_tenant_provisioned');
  } catch (err) {
    const code = (err as { code?: string } | undefined)?.code;
    if (code !== 'SUBDOMAIN_TAKEN') throw err;
    const list = await tenantsService.list({ includeDeleted: true, pageSize: 100 });
    const existing = list.items.find((t) => t.subdomainSlug === spec.subdomainSlug);
    if (!existing) {
      // Should be unreachable — SUBDOMAIN_TAKEN means a row with this slug exists.
      throw new Error(`SUBDOMAIN_TAKEN reported for '${spec.subdomainSlug}' but no matching tenant row was found.`);
    }
    tenant = { id: existing.id, schemaName: existing.schemaName, status: existing.status };
    logger.info({ subdomainSlug: spec.subdomainSlug, tenantId: tenant.id }, 'seed.demo_tenant_already_exists');
  }

  if (tenant.status !== 'Active') {
    // A tenant stuck in Provisioning/Failed from a previous partial run — retry rather than silently
    // proceeding to upgrade/password steps against a half-provisioned schema.
    const retried = await provisioning.retry(tenant.id);
    tenant = { id: retried.id, schemaName: retried.schemaName, status: retried.status };
  }

  if (spec.packageKey !== 'starter') {
    const billing = await getBillingRepositories();
    const pkg = await billing.packages.findByKey(spec.packageKey);
    if (!pkg) {
      throw new Error(
        `Cannot upgrade demo tenant '${spec.subdomainSlug}' to package '${spec.packageKey}': not found in the catalog. ` +
          'Ensure platform migrations (step 1) ran first.',
      );
    }
    await billing.subscriptions.upsertForTenant(tenant.id, pkg.id, 'ACTIVE');
    logger.info({ subdomainSlug: spec.subdomainSlug, packageKey: spec.packageKey }, 'seed.demo_tenant_package_upgraded');
  }

  await setKnownTenantAdminPassword(tenant.id, tenant.schemaName, spec.adminEmail);

  return tenant;
}

/** Step 5: sets a known bcrypt password hash directly on the seeded Tenant Admin — bypassing the real
 * invite-token-set-password flow entirely (documented deviation, see file header). Reuses the exact
 * same `TenantDataSourceRegistry`/`UserRepository.setPasswordHash`/`runWithRequestContext` pattern
 * `scripts/provision-phase3-demo-tenant.ts` already established for this identical need (see that
 * file's own doc comment for the fuller "verification convenience, not an auth bypass" rationale:
 * the Tenant Admin still authenticates through the real `POST /api/auth/login` -> bcrypt compare ->
 * JWT issuance afterward; only the initial password-setting step skips the invite-email round trip).
 * Idempotent — an unconditional `setPasswordHash` call always converges to the same verifiable
 * password (bcrypt's own per-call salt makes the stored hash differ byte-for-byte between runs, which
 * is expected and not a correctness issue — the password it verifies against is identical). */
async function setKnownTenantAdminPassword(tenantId: string, schemaName: string, adminEmail: string): Promise<void> {
  const env = getEnv();
  const registry = getTenantDataSourceRegistry();
  const dataSource = await registry.acquire(schemaName);
  try {
    await runWithRequestContext(
      { requestId: randomUUID(), tenantId, tenantSlug: schemaName, tenantSchema: schemaName, tenantDataSource: dataSource },
      async () => {
        const users = new UserRepository(dataSource);
        const admin = await users.findByEmail(adminEmail);
        if (!admin) {
          throw new Error(`Seeded Tenant Admin ${adminEmail} not found in schema ${schemaName} after provisioning.`);
        }
        const hasher = new BcryptPasswordHasherAdapter(env.BCRYPT_COST);
        await users.setPasswordHash(admin.id, await hasher.hash(DEMO_TENANT_ADMIN_PASSWORD));
      },
    );
  } finally {
    registry.release(schemaName);
  }
}

/** Step 6: restores full feature-usage headroom for the demo tenants (see file header for why this is
 * necessary, not merely convenient) — a plain, unconditional `DELETE`, safe to run whether or not any
 * usage rows exist yet (a fresh cold-volume stack has none). Deliberately scoped to only the given
 * tenant ids (not a blanket `DELETE FROM tenant_feature_usage`) — this script must never reset usage
 * for a tenant it didn't itself seed (e.g. one created live by `cluster1-identity-tenancy.spec.ts`'s
 * own provisioning test). */
async function resetDemoTenantFeatureUsage(tenantIds: string[]): Promise<void> {
  if (tenantIds.length === 0) return;
  const ds = await getPlatformDataSource();
  const placeholders = tenantIds.map(() => '?').join(', ');
  const result: { affectedRows?: number } = await ds.query(`DELETE FROM tenant_feature_usage WHERE tenant_id IN (${placeholders})`, tenantIds);
  logger.info({ tenantIds, deletedRows: result?.affectedRows ?? 0 }, 'seed.demo_tenant_feature_usage_reset');
}

async function bootstrap(): Promise<void> {
  // eslint-disable-next-line no-console -- CLI script's own user-facing progress output, not application logging.
  console.log(JSON.stringify({ status: 'seed_starting' }));

  await runPlatformMigrations();
  await seedPlatformAdmin();

  const tenants: { subdomainSlug: string; id: string; schemaName: string; packageKey: string }[] = [];
  for (const spec of DEMO_TENANTS) {
    const tenant = await seedDemoTenant(spec);
    tenants.push({ subdomainSlug: spec.subdomainSlug, id: tenant.id, schemaName: tenant.schemaName, packageKey: spec.packageKey });
  }

  await resetDemoTenantFeatureUsage(tenants.map((t) => t.id));

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        status: 'seed_complete',
        platformAdminEmail: getEnv().PLATFORM_ADMIN_BOOTSTRAP_EMAIL || null,
        demoTenantAdminPassword: DEMO_TENANT_ADMIN_PASSWORD,
        tenants,
      },
      null,
      2,
    ),
  );
  process.exitCode = 0;
}

bootstrap()
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Fatal error running seed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Same explicit-teardown rationale as `provision-demo-tenant.ts` — no DI-container `app.close()`
    // lifecycle exists in this app, so the platform DataSource's pool must be destroyed explicitly or
    // this process never exits (an open pool keeps the event loop alive indefinitely).
    try {
      const ds = await getPlatformDataSource();
      await ds.destroy();
    } catch {
      // Best-effort — a teardown failure must not mask this script's real exit code.
    }
    process.exit(process.exitCode ?? 0);
  });
