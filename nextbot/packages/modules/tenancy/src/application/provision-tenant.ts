import { eq, or } from "drizzle-orm";
import { generateId, schema, type Region } from "@nextbot/db";
import { withPlatform, type PlatformClient } from "@nextbot/db/platform-only";
import { TenantAlreadyExistsError, type PlanTierValue, type ProvisionTenantRequest } from "@nextbot/contracts";
import { getEffectivePlanTierDefaults } from "./plan-tier-definitions.js";
import { validateRetentionDays } from "../domain/retention-policy.js";
import { provisionTenantGraphDatabase } from "./provision-tenant-graph.js";

/** Postgres unique_violation SQLSTATE (used as a race-condition backstop, see below). */
const UNIQUE_VIOLATION = "23505";

export interface ProvisionedTenant {
  id: string;
  name: string;
  slug: string;
  region: Region;
  planTier: PlanTierValue;
}

/**
 * Provisions a new tenant (BL-01 data/domain slice): creates the `tenant` row plus
 * its 1:1 `tenant_data_policy` and `tenant_runtime_quota` rows (seeded from the plan
 * tier's defaults, LLD §3.10 NFR-4a table), and — for Enterprise tenants — the
 * dedicated-database routing record (ADR-0001 §2a escape hatch; the *routing* row
 * only, physical provisioning of a second database is nexus-deploy scope).
 *
 * Runs entirely inside a single `withPlatform` transaction: this is one of the two
 * call sites LLD §3.2 rule 4 permits, precisely because a tenant cannot have a
 * `TenantContext` before its own row exists.
 *
 * Platform Manager console Phase 1 (NFR-11): also writes exactly one
 * `platform_audit_log_entry` row, in the same transaction, recording who provisioned
 * this tenant. `actorLabel` defaults to `"system"` for the pre-existing non-HTTP call
 * sites (`scripts/seed.ts`, this package's own tests) that have no operator identity
 * to attribute to; the real operator console's route handler always passes a real
 * label.
 *
 * @throws {TenantAlreadyExistsError} when `name` or `slug` collides with an existing tenant.
 * @throws {RetentionPeriodInvalidError} when a retention field is 0/blank without explicit indefinite mode.
 */
export async function provisionTenant(
  input: ProvisionTenantRequest,
  actorLabel = "system",
): Promise<ProvisionedTenant> {
  const retentionMode = input.retention?.mode === "indefinite";
  const retention = {
    transcripts: validateRetentionDays(
      "retention.transcriptsDays",
      input.retention?.transcriptsDays,
      retentionMode,
    ),
    toolPayloads: validateRetentionDays(
      "retention.toolPayloadsDays",
      input.retention?.toolPayloadsDays,
      retentionMode,
    ),
    toolMetadata: validateRetentionDays(
      "retention.toolMetadataDays",
      input.retention?.toolMetadataDays,
      retentionMode,
    ),
    pii: validateRetentionDays("retention.piiDays", input.retention?.piiDays, retentionMode),
  };

  // Platform Manager console Phase 2 (NFR-11): reads the *currently configured*
  // plan-tier defaults (`plan_tier_definition`, editable at runtime) rather than the
  // originally-hardcoded `getPlanTierQuotaDefaults()` directly — falls back to that
  // same pure function if the row is ever missing. This is the one call site that
  // makes provisioning pick up an operator's plan-tier-definition edits.
  const quotaDefaults = await getEffectivePlanTierDefaults(input.planTier);
  const tenantId = generateId();

  const provisioned = await withPlatform(async (db: PlatformClient) => {
    const existing = await db
      .select({ id: schema.tenant.id, name: schema.tenant.name, slug: schema.tenant.slug })
      .from(schema.tenant)
      .where(or(eq(schema.tenant.name, input.name), eq(schema.tenant.slug, input.slug)));

    const nameClash = existing.find((r) => r.name === input.name);
    if (nameClash) throw new TenantAlreadyExistsError("name", input.name);
    const slugClash = existing.find((r) => r.slug === input.slug);
    if (slugClash) throw new TenantAlreadyExistsError("slug", input.slug);

    try {
      await db.insert(schema.tenant).values({
        id: tenantId,
        name: input.name,
        slug: input.slug,
        region: input.region,
        planTier: input.planTier,
        defaultLanguage: input.defaultLanguage,
        // QA fix (BE-1): the `tenant_status` column's schema-level default is
        // "Trial", but nothing in the spec defines a time-boxed trial-period
        // feature or a separate activation step — a provisioned tenant is meant
        // to be immediately operational. Without this explicit override, every
        // real tenant silently failed to match `listActiveTenantContexts()`'s
        // `status = 'Active'` filter and was skipped by every apps/worker
        // scheduled job (git-sweep, idle-sweep, audit-sync, health-check,
        // retention-purge) forever. If a real trial-period product feature is
        // built later, it should explicitly transition status away from
        // "Active" (or introduce its own gating field) rather than relying on
        // this default.
        status: "Active",
      });
    } catch (err) {
      // Race-condition backstop: two concurrent provisioning calls with the same
      // name/slug can both pass the SELECT-based check above; the DB's UNIQUE
      // constraint is the actual guarantee, this just gives it a friendly error type.
      if (isUniqueViolation(err)) {
        throw new TenantAlreadyExistsError("name", input.name);
      }
      throw err;
    }

    await db.insert(schema.tenantDataPolicy).values({
      tenantId,
      retentionTranscriptsDays: retention.transcripts,
      retentionToolPayloadsDays: retention.toolPayloads,
      retentionToolMetadataDays: retention.toolMetadata,
      retentionPiiDays: retention.pii,
      residencyRegion: input.region,
    });

    await db.insert(schema.tenantRuntimeQuota).values({
      tenantId,
      maxToolCallsPerSecond: quotaDefaults.maxToolCallsPerSecond,
      maxConcurrentConversations: quotaDefaults.maxConcurrentConversations,
      maxMcpConnectors: quotaDefaults.maxMcpConnectors,
    });

    await db.insert(schema.tenantDatabaseRoute).values({
      tenantId,
      isDedicated: quotaDefaults.isDedicatedDatabase,
      // dsnVaultRef stays NULL: standing up a second physical database for the
      // Enterprise escape hatch is nexus-deploy infra work (flagged in the plan's
      // open items, not built ad hoc here). The routing row's presence with
      // isDedicated=true is what a later deploy step keys off of.
      dsnVaultRef: null,
    });

    // Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — cross-channel
    // identity resolution's tenant-opt-in row, created explicitly OFF
    // (`enabled` defaults `false` at the column level too — every new tenant starts
    // with linking disabled, never auto-opted-in). A tenant provisioned before this
    // phase shipped has no row at all; `getIdentityResolutionPolicy()` treats a
    // missing row identically to an explicit `enabled: false` (same fail-closed
    // default), and `setIdentityResolutionPolicyEnabled()` upserts rather than
    // assuming this row already exists.
    await db.insert(schema.tenantIdentityResolutionPolicy).values({ tenantId, enabled: false });

    // Platform Manager console Phase 1 (NFR-11): one platform-level audit row per
    // provisioning action, in the same transaction as the tenant row itself — if the
    // transaction rolls back (e.g. the race-condition backstop above), the audit row
    // rolls back with it, so there is never an audit entry for a tenant that doesn't
    // actually exist.
    await db.insert(schema.platformAuditLogEntry).values({
      id: generateId(),
      actorLabel,
      actionType: "tenant.provision",
      targetTenantId: tenantId,
      details: { name: input.name, slug: input.slug, region: input.region, planTier: input.planTier },
    });

    return {
      id: tenantId,
      name: input.name,
      slug: input.slug,
      region: input.region,
      planTier: input.planTier,
    };
  });

  // Target Architecture Blueprint Phase 7a (ADR-0018) — the tenant's Neo4j graph
  // database is provisioned here, after the Postgres transaction above has
  // committed (a second datastore cannot participate in that transaction).
  // Deliberately best-effort/non-blocking — see `provisionTenantGraphDatabase`'s
  // own doc comment for the full disclosed rationale (a missing graph-store
  // config or an unreachable Neo4j must never fail tenant creation itself).
  await provisionTenantGraphDatabase(provisioned.id);

  return provisioned;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === UNIQUE_VIOLATION;
}
