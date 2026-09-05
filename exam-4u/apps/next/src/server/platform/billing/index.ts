import { getEnv } from '@/server/config';
import { getPlatformDataSource } from '@/server/infrastructure/database';
import { createPaymentGatewayPort } from '@/server/infrastructure/payments';
import { logger } from '@/server/logging';
import { getAuditLogService } from '@/server/platform/audit';
import { PackageRepository } from './infrastructure/package.repository';
import { FeatureRepository } from './infrastructure/feature.repository';
import { PackageFeatureRepository } from './infrastructure/package-feature.repository';
import { TenantSubscriptionRepository } from './infrastructure/tenant-subscription.repository';
import { FeaturesService } from './application/features.service';
import { PackagesService } from './application/packages.service';
import { BillingCheckoutService } from './application/billing-checkout.service';
import { BillingWebhookService } from './application/billing-webhook.service';
import { SubscriptionAdminService } from './application/subscription-admin.service';
import { TenantBillingService } from './application/tenant-billing.service';

export { PackageRepository, FeatureRepository, PackageFeatureRepository, TenantSubscriptionRepository };
export { FeaturesService, PackagesService, BillingCheckoutService, BillingWebhookService, SubscriptionAdminService, TenantBillingService };
export type { FeatureSummary } from './application/features.service';
export type { PackageSummary, PackageFeatureConfigSummary, PackageDetail } from './application/packages.service';
export type { TenantSubscriptionSummary } from './application/subscription-admin.service';
export type { TenantPlanSummary, TenantPlansResponse } from './application/tenant-billing.service';
export {
  FeatureKeyExistsError,
  FeatureKeyImmutableError,
  FeatureInUseError,
  FeatureNotFoundError,
  PackageKeyExistsError,
  PackageNotFoundError,
  PackageInactiveError,
  BillingNotConfiguredError,
  WebhookSignatureInvalidError,
} from './domain/errors';

/**
 * `server/platform/billing`'s public barrel — houses the package/feature/subscription catalog (the
 * migration plan's "New app structure" names this bounded context `billing`, grouping it with the
 * Stripe integration a later Phase 2 sub-dispatch adds; see `docs/plans/nextjs-rewrite-phase1-plan.md`'s
 * "Decisions made" for why packages/features/subscriptions live here rather than under a
 * `packages`/`features`/`subscriptions` split matching legacy's separate-NestJS-module-per-concept
 * granularity). Nothing outside this module may import `./infrastructure/**`/`./application/**`/
 * `./domain/**` directly (enforced by `apps/next/.eslintrc.cjs`'s `platform/billing` module-boundary
 * rule).
 *
 * Phase 1a shipped read-path repositories only. Phase 2 sub-slice "2b" added the write-side
 * `FeaturesService`/`PackagesService` — full CRUD over `platform.feature`/`platform.package`/
 * `platform.package_feature` for the Platform Admin console. This dispatch (Phase 2 sub-slice "2c",
 * FR-PKG-6) adds the Stripe integration: `BillingCheckoutService` (Platform-Admin-initiated Checkout
 * Session creation), `BillingWebhookService` (webhook-driven status transitions), and
 * `SubscriptionAdminService` (direct `reassignSubscription`, no Stripe involved) — closing out
 * `TenantSubscriptionRepository`'s write path.
 */
declare global {
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandBillingRepos:
    | Promise<{
        packages: PackageRepository;
        features: FeatureRepository;
        packageFeatures: PackageFeatureRepository;
        subscriptions: TenantSubscriptionRepository;
      }>
    | undefined;
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandFeaturesService: Promise<FeaturesService> | undefined;
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandPackagesService: Promise<PackagesService> | undefined;
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandBillingCheckoutService: Promise<BillingCheckoutService> | undefined;
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandBillingWebhookService: Promise<BillingWebhookService> | undefined;
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandSubscriptionAdminService: Promise<SubscriptionAdminService> | undefined;
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandTenantBillingService: Promise<TenantBillingService> | undefined;
}

/** Composition root for this module's four read-path repositories, all sharing the one platform
 * `DataSource`. Cached on `globalThis` for the same Next.js dev-hot-reload reason every other async
 * singleton in this app is. */
export async function getBillingRepositories(): Promise<{
  packages: PackageRepository;
  features: FeatureRepository;
  packageFeatures: PackageFeatureRepository;
  subscriptions: TenantSubscriptionRepository;
}> {
  if (!globalThis.__examlandBillingRepos) {
    globalThis.__examlandBillingRepos = getPlatformDataSource().then((ds) => ({
      packages: new PackageRepository(ds),
      features: new FeatureRepository(ds),
      packageFeatures: new PackageFeatureRepository(ds),
      subscriptions: new TenantSubscriptionRepository(ds),
    }));
  }
  return globalThis.__examlandBillingRepos;
}

/** Composition root for {@link FeaturesService} — the Platform Admin Features catalog CRUD service. */
export async function getFeaturesService(): Promise<FeaturesService> {
  if (!globalThis.__examlandFeaturesService) {
    globalThis.__examlandFeaturesService = getBillingRepositories().then((repos) => new FeaturesService(repos.features));
  }
  return globalThis.__examlandFeaturesService;
}

/** Composition root for {@link PackagesService} — the Platform Admin Packages catalog CRUD service. */
export async function getPackagesService(): Promise<PackagesService> {
  if (!globalThis.__examlandPackagesService) {
    globalThis.__examlandPackagesService = getBillingRepositories().then(
      (repos) => new PackagesService(repos.packages, repos.packageFeatures, repos.features),
    );
  }
  return globalThis.__examlandPackagesService;
}

/** This module's own derived-config helper (Phase 2 sub-slice "2c") — resolves the two Checkout
 * redirect-URL templates from `STRIPE_CHECKOUT_SUCCESS_URL`/`_CANCEL_URL`, falling back to this app's
 * own platform-console URL shape (`/platform/tenants/{tenantId}`, a real path on the same origin — see
 * `env.schema.ts`'s doc comment on why this differs from legacy's `admin.{PUBLIC_APEX_DOMAIN}`
 * subdomain-based default) when either is left unconfigured. Exported (not just used internally) so
 * this dispatch's own tests can assert the derivation without needing a real env boot. */
export function resolveCheckoutRedirectTemplates(
  env: ReturnType<typeof getEnv>,
): { checkoutSuccessUrlTemplate: string; checkoutCancelUrlTemplate: string } {
  return {
    checkoutSuccessUrlTemplate: env.STRIPE_CHECKOUT_SUCCESS_URL || `https://${env.PUBLIC_APEX_DOMAIN}/platform/tenants/{tenantId}?checkout=success`,
    checkoutCancelUrlTemplate: env.STRIPE_CHECKOUT_CANCEL_URL || `https://${env.PUBLIC_APEX_DOMAIN}/platform/tenants/{tenantId}?checkout=cancel`,
  };
}

/** Composition root for {@link BillingCheckoutService} — Platform-Admin-initiated Stripe Checkout
 * Session creation. Cached on `globalThis` for the same Next.js dev-hot-reload reason every other
 * async singleton in this app is (see `server/config/index.ts`'s doc comment) — the `PaymentGatewayPort`
 * it holds is constructed once from whichever `getEnv()` snapshot is current on first call (cheap,
 * side-effect-free even when unconfigured — see `infrastructure/payments`'s own doc comment). */
export async function getBillingCheckoutService(): Promise<BillingCheckoutService> {
  if (!globalThis.__examlandBillingCheckoutService) {
    globalThis.__examlandBillingCheckoutService = getBillingRepositories().then((repos) => {
      const env = getEnv();
      const gateway = createPaymentGatewayPort(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
      return new BillingCheckoutService(repos.packages, repos.subscriptions, gateway, {
        stripeSecretKey: env.STRIPE_SECRET_KEY,
        stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
        ...resolveCheckoutRedirectTemplates(env),
      });
    });
  }
  return globalThis.__examlandBillingCheckoutService;
}

/** Composition root for {@link BillingWebhookService} — verifies + processes inbound Stripe webhook
 * events. */
export async function getBillingWebhookService(): Promise<BillingWebhookService> {
  if (!globalThis.__examlandBillingWebhookService) {
    globalThis.__examlandBillingWebhookService = Promise.all([getBillingRepositories(), getAuditLogService()]).then(
      ([repos, audit]) => {
        const env = getEnv();
        const gateway = createPaymentGatewayPort(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
        return new BillingWebhookService(gateway, repos.subscriptions, repos.packages, audit, logger);
      },
    );
  }
  return globalThis.__examlandBillingWebhookService;
}

/** Composition root for {@link SubscriptionAdminService} — direct (non-Stripe) tenant-subscription
 * reassignment plus the tenant-detail billing panel's read path. */
export async function getSubscriptionAdminService(): Promise<SubscriptionAdminService> {
  if (!globalThis.__examlandSubscriptionAdminService) {
    globalThis.__examlandSubscriptionAdminService = getBillingRepositories().then(
      (repos) => new SubscriptionAdminService(repos.packages, repos.subscriptions),
    );
  }
  return globalThis.__examlandSubscriptionAdminService;
}

/** Composition root for {@link TenantBillingService} — the self-serve (Tenant-Admin-initiated) half
 * of FR-PKG-6 (migration plan Phase 9 sub-slice "9b"). Reuses the same {@link getBillingCheckoutService}
 * singleton `BillingCheckoutService` this module already constructs for the Platform-Admin-initiated
 * path — one Stripe-configured service, two call sites. */
export async function getTenantBillingService(): Promise<TenantBillingService> {
  if (!globalThis.__examlandTenantBillingService) {
    globalThis.__examlandTenantBillingService = Promise.all([getBillingRepositories(), getBillingCheckoutService()]).then(
      ([repos, checkout]) => new TenantBillingService(repos.packages, repos.subscriptions, checkout),
    );
  }
  return globalThis.__examlandTenantBillingService;
}
