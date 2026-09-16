/**
 * CLI entry point for B9's deterministic demo data — run once per environment, safe to
 * re-run (idempotent throughout, matching `seed-system-skins.ts`'s own precedent).
 *
 *   pnpm exec tsx scripts/seed-iam-demo-data.ts
 *
 * (also wired as `pnpm db:seed:iam`.) Closes the long-standing, separately-tracked B-0 open
 * item ("deterministic seed data matching the wireframe's sample state, two tenants
 * minimum") — done here, in B-2, since users/teams/roles are exactly this module's data.
 *
 * ## What this seeds, and why four tenants
 *
 * The wireframe's own B9 tab 1 sample rows span four distinct team/entity affiliations —
 * SEWA, Customs, Libraries, and the Platform operator itself (Ahmed Saeed, Super Admin,
 * team "Platform" with `AllEntities` scope) — so faithfully reproducing "the exact rows"
 * the brief specifies needs all four tenants, not just the two-tenant floor. `sewa`/
 * `customs` reuse the exact slugs and display names `tests/isolation/setup.ts` already
 * established as this codebase's real, precedent tenant identities for these two
 * government entities; `libraries` and `sharjah` (the platform operator — `platform` itself
 * is a reserved schema name, `tenancy/tenant-slug.ts`, so it cannot be the slug) are new.
 *
 * ## A real interaction with the isolation suite, documented rather than silently risked
 *
 * `tests/isolation/setup.ts` provisions-then-destroys `sewa`/`customs` on every isolation
 * run (`pnpm test:isolation`, or `pnpm verify`'s full, non-`--staged` pass) — a *different*
 * lifecycle than this script's "seed once, leave it" demo data. Running the isolation suite
 * after this script will wipe `sewa`/`customs` (all four stores, including the data this
 * script wrote); running this script again afterward fully repairs it, since every step here
 * is idempotent. This is a real, occasional interaction to know about, not a design flaw:
 * the isolation suite is explicitly a rare, deliberate "release gate" action
 * (`scripts/verify.mjs`'s own doc comment: "full pass ... never skipped" but distinct from
 * the routine `--staged` one every wave in this session actually runs), not part of the
 * everyday dev loop.
 *
 * ## Composition root, not application code
 *
 * Constructs concrete adapters (`PrismaDemoDataSeeder`, the four real `StoreProvisioner`s)
 * directly, which `application/` code may never do (the swap test, architecture.md §4) —
 * the identical reasoning `seed-system-skins.ts`'s own module comment gives. Every
 * `runWithTenant` binding happens here, not inside `modules/iam/application/seed-demo-
 * data.ts` (see that file's own doc comment for why: its functions are single-tenant-scoped
 * and assume the caller already bound the right context — exactly mirroring `tests/
 * isolation/setup.ts`'s `runAsProvisioning` pattern).
 */

import { randomUUID } from "node:crypto";
import type {
  AuditActor,
  Clock,
  StoreProvisioner,
} from "../apps/web/src/modules/platform/ports/provisioning.js";
import { ProvisionTenant } from "../apps/web/src/modules/platform/application/provision-tenant.js";
import { PrismaTenantRegistry } from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-registry.js";
import { PlatformAuditSink } from "../apps/web/src/modules/platform/adapters/outbound/sql/audit-sink.js";
import { SqlStoreProvisioner } from "../apps/web/src/modules/platform/adapters/outbound/sql/sql-store-provisioner.js";
import { RedisStoreProvisioner } from "../apps/web/src/modules/platform/adapters/outbound/cache/redis-store-provisioner.js";
import { AiGraphProvisioner } from "../apps/web/src/modules/platform/adapters/outbound/graph/ai-graph-provisioner.js";
import { AiVectorProvisioner } from "../apps/web/src/modules/platform/adapters/outbound/vector/ai-vector-provisioner.js";
import { disconnectAllTenantDbs } from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { disconnectCache } from "../apps/web/src/modules/platform/adapters/outbound/cache/tenant-cache.js";
import { runWithTenant } from "../apps/web/src/modules/platform/tenancy/tenant-context.js";
import {
  assertValidSlugShape,
  type TenantSlug,
} from "../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import { ROLE_KEYS } from "../apps/web/src/modules/iam/domain/permissions.js";
import { PrismaDemoDataSeeder } from "../apps/web/src/modules/iam/adapters/outbound/sql/prisma-demo-data-seeder.js";
import {
  seedPermissionCatalog,
  seedStaffUser,
  seedTenantRolesAndTeam,
  seedUserMembershipAndRole,
  type DemoStaffUser,
  type DemoTenant,
} from "../apps/web/src/modules/iam/application/seed-demo-data.js";

const SEWA: TenantSlug = assertValidSlugShape("sewa");
const CUSTOMS: TenantSlug = assertValidSlugShape("customs");
const LIBRARIES: TenantSlug = assertValidSlugShape("libraries");
/** The platform-operator tenant — `platform` itself is a reserved schema name (`tenancy/tenant-slug.ts`), so this is the nearest legal slug for "the Emirate's own operator tenant". */
const SHARJAH: TenantSlug = assertValidSlugShape("sharjah");

const TENANTS: readonly DemoTenant[] = [
  { slug: SEWA, team: { name: "SEWA Billing", scope: "Tenant" } },
  { slug: CUSTOMS, team: { name: "Customs", scope: "Tenant" } },
  { slug: LIBRARIES, team: { name: "Libraries", scope: "Tenant" } },
  // The one AllEntities-scoped team the wireframe shows — legal only inside the platform
  // operator's own tenant (`TR_Teams_crossEntityScope`, `TenantProfiles.isPlatformTenant`,
  // both exercised for real by this script for the first time).
  { slug: SHARJAH, team: { name: "Platform", scope: "AllEntities" } },
];

const TENANT_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  [SEWA]: "Sharjah Electricity, Water & Gas Authority",
  [CUSTOMS]: "Sharjah Customs",
  [LIBRARIES]: "Sharjah Libraries",
  [SHARJAH]: "Sharjah (Platform)",
};

/**
 * B9 tab 1's five sample rows, transcribed exactly (`docs/SHJ3-wireframes-guide.md`),
 * plus one additional, honestly-flagged E2E-only fixture appended at the end (Khalid Al
 * Marzouqi) — not part of the wireframe's own five rows. Added 2026-09-10 to close a
 * real, named gap: no seeded `StaffUser` combined `sewa` tenant membership with
 * `escalations:handle`, which blocked `e2e/widget/conversation.spec.ts` from proving a
 * citizen-initiated handover is reflected in the real escalation queue through the real
 * staff UI (the same class of gap `tasks/todo.md`'s own Phase D follow-up review named
 * for `channels.spec.ts`'s deferred "approve → unblocks" proof: "a future pass adding
 * one more seeded principal would close this cleanly"). Appended, not inserted, so the
 * original five rows' own ordinal/position guarantees are untouched.
 */
const USERS: readonly DemoStaffUser[] = [
  {
    email: "sara.almazrouei@shj.ae",
    displayName: "Sara Al Mazrouei",
    status: "Active",
    tenant: SEWA,
    roleKey: ROLE_KEYS.AgentDesigner,
  },
  {
    email: "omar.khan@shj.ae",
    displayName: "Omar Khan",
    status: "Active",
    tenant: CUSTOMS,
    roleKey: ROLE_KEYS.LiveAgent,
  },
  {
    email: "priya.nair@shj.ae",
    displayName: "Priya Nair",
    status: "Invited",
    tenant: LIBRARIES,
    roleKey: ROLE_KEYS.KnowledgeManager,
  },
  {
    email: "ahmed.saeed@shj.ae",
    displayName: "Ahmed Saeed",
    status: "Active",
    tenant: SHARJAH,
    roleKey: ROLE_KEYS.SuperAdmin,
  },
  {
    email: "lina.haddad@shj.ae",
    displayName: "Lina Haddad",
    status: "Suspended",
    tenant: LIBRARIES,
    roleKey: ROLE_KEYS.Reviewer,
  },
  {
    email: "khalid.marzouqi@shj.ae",
    displayName: "Khalid Al Marzouqi",
    status: "Active",
    tenant: SEWA,
    roleKey: ROLE_KEYS.LiveAgent,
  },
];

/** Matches `tests/isolation/setup.ts`'s own real embedding contract rather than a suite-local constant. */
const EMBEDDING_MODEL = process.env.SHJ3_OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-large";
const EMBEDDING_DIMENSIONS = Number(process.env.SHJ3_OPENAI_EMBEDDING_DIM ?? 3072);
const ENVIRONMENT_KEY = process.env.SHJ3_ENVIRONMENT ?? "development";
const SYSTEM_ACTOR: AuditActor = { kind: "System", label: "seed-iam-demo-data" };

function systemClock(): Clock {
  return { now: () => new Date() };
}

function newTraceId(): string {
  return randomUUID().replace(/-/g, "");
}

function buildProvisioners(): readonly StoreProvisioner[] {
  return [
    new SqlStoreProvisioner(),
    new RedisStoreProvisioner(),
    new AiGraphProvisioner(),
    new AiVectorProvisioner({
      embeddingModel: EMBEDDING_MODEL,
      embeddingDimensions: EMBEDDING_DIMENSIONS,
    }),
  ];
}

/** Every real query below needs *some* ambient tenant bound (`getPlatformDb()`'s `platformScope` gate, and `getTenantDb()`'s schema resolution) — `runAsBootstrap` is for platform-only work, where which tenant is ambient is irrelevant as long as one is bound (mirrors `tests/isolation/setup.ts`'s identical `runAsProvisioning` reasoning). */
function runAsBootstrap<T>(fn: () => Promise<T>): Promise<T> {
  return runWithTenant(
    { tenant: SEWA, principal: null, traceId: newTraceId(), platformScope: "provisioning" },
    fn,
  );
}

function runForTenant<T>(tenant: TenantSlug, fn: () => Promise<T>): Promise<T> {
  return runWithTenant({ tenant, principal: null, traceId: newTraceId() }, fn);
}

/** Provisions `tenant` across all four stores if it is not already registered. Refuses (rather than guessing how to repair) a registered-but-not-`Active` row — the same "an operator must resolve this via RB-07/RB-10 first" stance `ProvisionTenant` itself already takes. */
async function ensureTenantProvisioned(tenant: TenantSlug): Promise<void> {
  await runAsBootstrap(async () => {
    const registry = new PrismaTenantRegistry();
    const existing = await registry.findBySlug(tenant);
    if (existing) {
      if (existing.status !== "Active") {
        throw new Error(
          `Tenant "${tenant}" is registered with status "${existing.status}", not "Active". ` +
            "This script does not repair a partially-provisioned tenant — resolve it via the " +
            "provisioning runbooks first (RB-07 resume, or RB-10 clean-up), then re-run this seed.",
        );
      }
      console.info(`[seed-iam-demo-data] tenant "${tenant}" already provisioned — skipping.`);
      return;
    }

    console.info(`[seed-iam-demo-data] provisioning tenant "${tenant}"...`);
    const useCase = new ProvisionTenant({
      registry,
      provisioners: buildProvisioners(),
      audit: new PlatformAuditSink(),
      clock: systemClock(),
    });
    await useCase.execute({
      slug: tenant,
      displayName: TENANT_DISPLAY_NAMES[tenant] ?? tenant,
      embeddingModel: EMBEDDING_MODEL,
      embeddingDimensions: EMBEDDING_DIMENSIONS,
      actor: SYSTEM_ACTOR,
      environment: ENVIRONMENT_KEY,
      entityKind: tenant === SHARJAH ? "PlatformOperator" : "GovernmentEntity",
    });
    console.info(`[seed-iam-demo-data] tenant "${tenant}" provisioned.`);
  });
}

async function main(): Promise<void> {
  for (const tenant of TENANTS) {
    await ensureTenantProvisioned(tenant.slug);
  }

  const seeder = new PrismaDemoDataSeeder();

  await runAsBootstrap(() => seedPermissionCatalog(seeder));
  console.info("[seed-iam-demo-data] platform.Permissions seeded.");

  const teamIdByTenant = new Map<TenantSlug, string>();
  for (const tenant of TENANTS) {
    const teamId = await runForTenant(tenant.slug, () => seedTenantRolesAndTeam(seeder, tenant));
    teamIdByTenant.set(tenant.slug, teamId);
    console.info(
      `[seed-iam-demo-data] tenant "${tenant.slug}": roles/grants + team "${tenant.team.name}" seeded.`,
    );
  }

  const staffUserIdByEmail = new Map<string, string>();
  for (const user of USERS) {
    const staffUserId = await runAsBootstrap(() => seedStaffUser(seeder, user));
    staffUserIdByEmail.set(user.email, staffUserId);
  }
  console.info(`[seed-iam-demo-data] ${USERS.length} staff user(s) seeded.`);

  for (const user of USERS) {
    const staffUserId = staffUserIdByEmail.get(user.email);
    const teamId = teamIdByTenant.get(user.tenant);
    if (staffUserId === undefined || teamId === undefined) {
      throw new Error(
        `Internal error: missing staffUserId/teamId for "${user.email}" — this is a bug in this script, not a data problem.`,
      );
    }
    await runForTenant(user.tenant, () =>
      seedUserMembershipAndRole(seeder, user.tenant, staffUserId, teamId, user.roleKey),
    );
  }
  console.info(
    `[seed-iam-demo-data] ${USERS.length} staff user(s)' team membership + role assignment seeded.`,
  );

  console.info("[seed-iam-demo-data] done.");
}

main()
  .catch((error: unknown) => {
    console.error("[seed-iam-demo-data] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectAllTenantDbs();
    await disconnectCache();
  });
