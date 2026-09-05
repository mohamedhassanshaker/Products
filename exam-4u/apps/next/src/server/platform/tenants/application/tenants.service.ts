import { randomUUID } from 'node:crypto';
import { getEnv } from '@/server/config';
import { getTenantDataSourceRegistry, type TenantEntity } from '@/server/infrastructure/database';
import { generateTenantSchemaName, isValidSubdomainSlug } from '@/server/common/util/tenant-slug.util';
import { validateAccent } from '../domain/color-contrast';
import {
  InvalidSubdomainError,
  InvalidTenantStateError,
  SubdomainTakenError,
  TenantNameRequiredError,
  TenantNotFoundError,
} from '../domain/errors';
import type {
  BrandingSummary,
  CreateTenantInput,
  ListTenantsOptions,
  ListTenantsResult,
  TenantSummary,
  UpdateBrandingInput,
} from '../domain/tenant.types';
import { PlatformTenantRepository } from '../infrastructure/tenant.repository';

/**
 * Platform-side CRUD for `platform.tenant` (FR-MT-1) — ported from
 * `legacy/api/src/platform/tenants/application/tenants.service.ts`, adapted from a NestJS
 * `@Injectable()` provider to a plain class this module's barrel constructs (no DI container).
 *
 * **Deliberately out of scope here** (this dispatch, mirroring legacy's own equivalent-phase split):
 * actual tenant schema creation, RBAC seeding, admin-user seeding, and the `Provisioning → Active`
 * transition — all of that is `TenantProvisioningService`'s job (`server/platform/provisioning`),
 * which drives this service's `create()` (to obtain the row + its pre-generated schema name) and
 * then performs the real provisioning steps. A tenant created here is *not* reachable by end users
 * until that workflow moves it to `Active`.
 *
 * **`getBranding`/`updateBranding` (FR-MT-10) added Phase 9 sub-slice "9a"** — see those methods'
 * own doc comments; `color-contrast.ts`'s `validateAccent` is the sole enforcement point.
 *
 * **Still deliberately out of scope** (documented, not silently dropped):
 * - Tenant-resolution cache invalidation (`TenantResolutionCache.invalidate(...)` in the legacy
 *   service) — no such cache exists yet in this app (it's meaningful only once `middleware.ts`'s
 *   Host-header resolution path exists, the next Phase 1 sub-dispatch). `registry.destroyFor(...)`
 *   is still called on every mutation that can change how a tenant's schema connects (suspend/
 *   reactivate/soft-delete), since the `TenantDataSourceRegistry` this dispatch builds is a real,
 *   already-usable dependency — only the *cache* half of the pair is deferred.
 */
export class TenantsService {
  constructor(private readonly repo: PlatformTenantRepository) {}

  /**
   * Creates a new tenant row in `Provisioning` status. Does not create the tenant's actual MySQL
   * schema — only pre-computes and persists its deterministic name (HLD §4.1) so a later
   * provisioning step has a stable target to create.
   *
   * @throws {TenantNameRequiredError} if `name` is empty/whitespace-only (FR-MT-1).
   * @throws {InvalidSubdomainError} if `subdomainSlug` violates the character-set/length rule, or is
   *   a reserved subdomain (FR-MT-1).
   * @throws {SubdomainTakenError} if `subdomainSlug` is already in use by any tenant, including a
   *   soft-deleted one still within its retention window (FR-MT-1).
   */
  async create(input: CreateTenantInput): Promise<TenantSummary> {
    const name = input.name?.trim();
    if (!name) {
      throw new TenantNameRequiredError();
    }

    // Trims and lowercases before validating, so a Platform Admin typing "Acme" doesn't get an
    // avoidable INVALID_SUBDOMAIN for a case difference alone (judgment call ported verbatim from
    // legacy's identical comment — FR-MT-1 doesn't say whether mixed-case input must be rejected or
    // normalized).
    const slug = input.subdomainSlug?.trim().toLowerCase();
    if (!slug || !isValidSubdomainSlug(slug) || getEnv().RESERVED_SUBDOMAINS.includes(slug)) {
      throw new InvalidSubdomainError();
    }

    if (await this.repo.existsBySlug(slug)) {
      throw new SubdomainTakenError();
    }

    const saved = await this.repo.insert({
      id: randomUUID(),
      name,
      subdomainSlug: slug,
      schemaName: generateTenantSchemaName(slug),
      status: 'Provisioning',
      isDefault: false,
      allowEmailRegistration: true,
      allowGoogleSignIn: false,
      defaultSelfRegisterRole: null,
      logoUrl: null,
      accentColorOverride: null,
      provisioningError: null,
      provisioningHeartbeatAt: null,
      deletedAt: null,
      purgeAfterAt: null,
    });

    return this.toSummary(saved);
  }

  /**
   * Fetches one tenant by id, regardless of soft-delete state.
   *
   * @throws {TenantNotFoundError} if no row with `id` exists at all.
   */
  async get(id: string): Promise<TenantSummary> {
    const row = await this.repo.findById(id);
    if (!row) throw new TenantNotFoundError();
    return this.toSummary(row);
  }

  /** Paginated tenant listing (soft-deleted tenants excluded unless `options.includeDeleted`). */
  async list(options: ListTenantsOptions = {}): Promise<ListTenantsResult> {
    const { items, total } = await this.repo.findMany(options);
    return { items: items.map((row) => this.toSummary(row)), total };
  }

  /**
   * Suspends an `Active` tenant (FR-MT-1: "a distinct, explicit action from suspension"/deletion).
   * Forces the tenant's pooled `DataSource` to be rebuilt on next use, so no in-flight connection to
   * the now-Suspended tenant's schema is reused past this point (HLD §9.1).
   *
   * @throws {TenantNotFoundError} if `id` does not resolve to any tenant.
   * @throws {InvalidTenantStateError} if the tenant is not currently `Active`.
   */
  async suspend(id: string): Promise<TenantSummary> {
    const row = await this.repo.findById(id);
    if (!row) throw new TenantNotFoundError();
    if (row.status !== 'Active') {
      throw new InvalidTenantStateError(`Cannot suspend a tenant in status '${row.status}'; only an Active tenant can be suspended.`);
    }
    row.status = 'Suspended';
    const saved = await this.repo.save(row);
    await getTenantDataSourceRegistry().destroyFor(saved.schemaName);
    return this.toSummary(saved);
  }

  /**
   * Reverses a suspension, returning the tenant to `Active`.
   *
   * @throws {TenantNotFoundError} if `id` does not resolve to any tenant.
   * @throws {InvalidTenantStateError} if the tenant is not currently `Suspended`.
   */
  async reactivate(id: string): Promise<TenantSummary> {
    const row = await this.repo.findById(id);
    if (!row) throw new TenantNotFoundError();
    if (row.status !== 'Suspended') {
      throw new InvalidTenantStateError(`Cannot reactivate a tenant in status '${row.status}'; only a Suspended tenant can be reactivated.`);
    }
    row.status = 'Active';
    const saved = await this.repo.save(row);
    await getTenantDataSourceRegistry().destroyFor(saved.schemaName);
    return this.toSummary(saved);
  }

  /**
   * Soft-deletes a tenant (FR-MT-1: "archival retention... rather than immediate hard delete").
   * Stamps `deletedAt`/`purgeAfterAt` (now + `TENANT_RETENTION_DAYS`) rather than removing the row.
   *
   * @throws {TenantNotFoundError} if `id` does not resolve to any tenant, or the tenant is already
   *   soft-deleted (idempotency safety — a second delete is treated as "already gone").
   */
  async softDelete(id: string): Promise<TenantSummary> {
    const row = await this.repo.findById(id);
    if (!row || row.deletedAt) throw new TenantNotFoundError();

    const now = new Date();
    row.deletedAt = now;
    row.purgeAfterAt = new Date(now.getTime() + getEnv().TENANT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const saved = await this.repo.save(row);
    await getTenantDataSourceRegistry().destroyFor(saved.schemaName);
    return this.toSummary(saved);
  }

  /**
   * FR-MT-6: toggles `allowEmailRegistration`/`allowGoogleSignIn`. `undefined` on either field leaves
   * it unchanged.
   *
   * @throws {TenantNotFoundError} if `id` does not resolve to any tenant.
   */
  async updateRegistrationSettings(
    id: string,
    input: { allowEmailRegistration?: boolean; allowGoogleSignIn?: boolean },
  ): Promise<TenantSummary> {
    const row = await this.repo.findById(id);
    if (!row) throw new TenantNotFoundError();

    if (input.allowEmailRegistration !== undefined) row.allowEmailRegistration = input.allowEmailRegistration;
    if (input.allowGoogleSignIn !== undefined) row.allowGoogleSignIn = input.allowGoogleSignIn;

    const saved = await this.repo.save(row);
    return this.toSummary(saved);
  }

  /**
   * FR-MT-10 — reads the acting tenant's own branding (`GET /api/tenant/branding`). Returns the raw
   * `accentColorOverride` (possibly `null`) alongside `effectiveAccentColor` (the override, or the
   * platform default, `THEME_DEFAULT_ACCENT_COLOR`) so a caller never has to re-derive that fallback
   * itself — mirrors `GET /api/tenant/public-config`'s identical `?? env.THEME_DEFAULT_ACCENT_COLOR`
   * computation, centralized here as this dispatch's dedicated branding read path.
   *
   * @throws {TenantNotFoundError} if `id` does not resolve to any tenant.
   */
  async getBranding(id: string): Promise<BrandingSummary> {
    const row = await this.repo.findById(id);
    if (!row) throw new TenantNotFoundError();
    return {
      logoUrl: row.logoUrl,
      accentColorOverride: row.accentColorOverride,
      effectiveAccentColor: row.accentColorOverride ?? getEnv().THEME_DEFAULT_ACCENT_COLOR,
    };
  }

  /**
   * FR-MT-10 — the sole write path for a tenant's own branding (`PATCH /api/tenant/branding`,
   * tenant-admin-gated by the Route Handler's own `requirePermission('tenant.settings.manage')` call,
   * never this service). Both fields are tri-state: `undefined` = leave unchanged, `null` = clear
   * (revert to the platform default), a string = validate + set.
   *
   * `validateAccent` (LLD §9.11) is the **only** place accent contrast is enforced — this is
   * deliberately the sole call site in the entire app, matching the migration plan's "`PATCH
   * /api/tenant/branding` remains the only place `validateAccent` runs (client never validates)".
   *
   * @throws {TenantNotFoundError} if `id` does not resolve to any tenant.
   * @throws {InvalidColorFormatError} via `validateAccent` if `accentColorOverride` isn't a well-formed
   *   6-digit hex.
   * @throws {InsufficientColorContrastError} via `validateAccent` if `accentColorOverride` fails the
   *   WCAG 2.2 AA contrast check against either published surface anchor.
   */
  async updateBranding(id: string, input: UpdateBrandingInput): Promise<BrandingSummary> {
    const row = await this.repo.findById(id);
    if (!row) throw new TenantNotFoundError();

    if (input.logoUrl !== undefined) {
      row.logoUrl = input.logoUrl;
    }

    if (input.accentColorOverride !== undefined) {
      const env = getEnv();
      row.accentColorOverride =
        input.accentColorOverride === null
          ? null
          : validateAccent(input.accentColorOverride, {
              surfaceLight: env.THEME_SURFACE_LIGHT,
              surfaceDark: env.THEME_SURFACE_DARK,
              minRatio: env.ACCENT_CONTRAST_MIN_RATIO,
            });
    }

    const saved = await this.repo.save(row);
    return {
      logoUrl: saved.logoUrl,
      accentColorOverride: saved.accentColorOverride,
      effectiveAccentColor: saved.accentColorOverride ?? getEnv().THEME_DEFAULT_ACCENT_COLOR,
    };
  }

  private toSummary(row: TenantEntity): TenantSummary {
    return {
      id: row.id,
      name: row.name,
      subdomainSlug: row.subdomainSlug,
      schemaName: row.schemaName,
      status: row.status,
      isDefault: row.isDefault,
      allowEmailRegistration: row.allowEmailRegistration,
      allowGoogleSignIn: row.allowGoogleSignIn,
      defaultSelfRegisterRole: row.defaultSelfRegisterRole,
      logoUrl: row.logoUrl,
      accentColorOverride: row.accentColorOverride,
      assignedAiModelId: row.assignedAiModelId,
      provisioningError: row.provisioningError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
      purgeAfterAt: row.purgeAfterAt,
    };
  }
}
