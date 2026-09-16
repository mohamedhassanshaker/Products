/**
 * CLI entry point for B-3's deterministic demo data (the agent registry + tools/skills/MCP/
 * connectors/circuit-breakers screens) — run once per environment, safe to re-run
 * (idempotent throughout, matching `seed-iam-demo-data.ts`'s own precedent, which this file
 * mirrors structurally end to end).
 *
 *   pnpm exec tsx scripts/seed-agents-tools-demo-data.ts
 *
 * (also wired as `pnpm db:seed:agents`.) Closes the agents/tools half of the same
 * long-standing B-0 open item ("deterministic seed data matching the wireframe's sample
 * state") that `seed-iam-demo-data.ts` already closed for users/teams/roles.
 *
 * ## What this seeds, and in which tenants
 *
 * Four agents (`docs/SHJ3-wireframes-guide.md` B2's own "Seeded agents" + "Version history
 * contents" tables, transcribed exactly — including the full per-version `changeSummary`
 * text B2 gives for every one of the four, not only SEWA's): SEWA & Utilities Billing
 * (tenant `sewa`), Customs Enquiry (`customs`), Library Services (`libraries`, the one
 * seeded agent left `Draft`), and General FAQ (`sharjah`, the platform-operator tenant —
 * B2 lists its owner as "Platform"). Then the B3 step 4 / B5 skills, MCP servers, API
 * connectors and circuit breakers — `sewa`'s full demo catalogue via
 * `modules/tools/application/seed-demo-data.ts`'s four original functions, called in the
 * one order they require (circuit breakers needs the MCP server/connector ids the first two
 * calls mint) — and, closing a real bug found live (`sewa` had 33/2/2, the other three had
 * 0/0/0), each of `customs`/`libraries`/`sharjah`'s own smaller, real, domain-appropriate
 * starter catalogue (see that same module's doc comment for the full reasoning). This script
 * is idempotent (`ensure*` throughout), so re-running it against this environment's
 * already-provisioned `sharjah`/`customs`/`libraries` tenants is exactly how their missing
 * tools/skills/MCP/connector rows were backfilled — no separate backfill script needed.
 *
 * ## A known, deliberate gap: per-agent usage/day
 *
 * B2's table also lists a `Usage` column (e.g. "412/day"). `DemoAgent` (`modules/agents/
 * application/seed-demo-data.ts`) has no field for it, and neither `DemoDataSeeder` port
 * exposes any usage-seeding hook — there is no `AgentUsageStat`-shaped write path yet
 * (usage is presumably derived from real conversation volume once the runtime exists, not
 * seeded fixture data). The registry's `usagePerDay` will therefore read back `null` for
 * every seeded agent. This is a real, known gap, left exactly as it is rather than papered
 * over with an invented usage-seeding mechanism this codebase does not otherwise have.
 *
 * ## Composition root, not application code
 *
 * Constructs concrete adapters directly, which `application/` code may never do (the swap
 * test, architecture.md §4) — identical reasoning to `seed-iam-demo-data.ts`'s own module
 * comment. Every `runWithTenant` binding happens here; `modules/agents/application/seed-
 * demo-data.ts` and `modules/tools/application/seed-demo-data.ts` are both single-tenant-
 * scoped and assume the caller already bound the right context (see each file's own doc
 * comment for why — `getTenantDb()`/`getTenantCache()` resolve from the *ambient* bound
 * tenant, not a parameter).
 *
 * ## Tenant provisioning, duplicated rather than shared
 *
 * This script must be runnable standalone (not only after `seed-iam-demo-data.ts`), so it
 * carries its own copy of that script's `ensureTenantProvisioned` guard rather than
 * importing it — there is no shared helper for it today, and hand-rolling a shared
 * abstraction for a ~30-line, already-idempotent guard used by exactly two CLI scripts
 * would be speculative generality. Small justified duplication over a forced abstraction is
 * this codebase's own precedent (`PrismaRoleRepository`'s own doc comment).
 *
 * ## `actorStaffUserId`-style attribution: no real `StaffUser` lookup needed
 *
 * `modules/agents/adapters/outbound/sql/prisma-demo-data-seeder.ts`'s own module comment
 * confirms every `*ByStaffUserId` column it writes uses a fixed, synthetic
 * `SYSTEM_SEED_ACTOR_ID` internally (not accepted as a caller parameter at all), and that
 * these columns are plain `Char(26)` with no FK against `platform.StaffUsers` (confirmed
 * against `prisma/tenant/schema.prisma`) — exactly mirroring `iam`'s own seeder. So this
 * script never needs to resolve a real seeded staff user's id for agent/version/history
 * attribution; `DemoAgent`'s own shape has no such field to fill in.
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
import type { ChannelKey } from "../apps/web/src/modules/agents/domain/agent.js";
import {
  seedAgentWithHistory,
  type DemoAgent,
} from "../apps/web/src/modules/agents/application/seed-demo-data.js";
import { PrismaDemoDataSeeder as PrismaAgentsDemoDataSeeder } from "../apps/web/src/modules/agents/adapters/outbound/sql/prisma-demo-data-seeder.js";
import {
  seedApiConnectors,
  seedCircuitBreakers,
  seedCustomsApiConnectors,
  seedCustomsMcpServers,
  seedCustomsSkills,
  seedLibrariesApiConnectors,
  seedLibrariesSkills,
  seedMcpServers,
  seedSharjahApiConnectors,
  seedSharjahSkills,
  seedSkills,
} from "../apps/web/src/modules/tools/application/seed-demo-data.js";
import { PrismaDemoDataSeeder as PrismaToolsDemoDataSeeder } from "../apps/web/src/modules/tools/adapters/outbound/sql/prisma-demo-data-seeder.js";
import { PrismaCircuitBreakerRepository } from "../apps/web/src/modules/tools/adapters/outbound/sql/prisma-circuit-breaker-repository.js";
import { RedisCircuitBreakerStateStore } from "../apps/web/src/modules/tools/adapters/outbound/cache/redis-circuit-breaker-state-store.js";

const SEWA: TenantSlug = assertValidSlugShape("sewa");
const CUSTOMS: TenantSlug = assertValidSlugShape("customs");
const LIBRARIES: TenantSlug = assertValidSlugShape("libraries");
/** The platform-operator tenant — see `seed-iam-demo-data.ts`'s identical constant for why `sharjah`, not `platform`, is the slug. */
const SHARJAH: TenantSlug = assertValidSlugShape("sharjah");

const TENANTS: readonly TenantSlug[] = [SEWA, CUSTOMS, LIBRARIES, SHARJAH];

const TENANT_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  [SEWA]: "Sharjah Electricity, Water & Gas Authority",
  [CUSTOMS]: "Sharjah Customs",
  [LIBRARIES]: "Sharjah Libraries",
  [SHARJAH]: "Sharjah (Platform)",
};

/** B2's four "Seeded agents" rows, cross-referenced with the "Version history contents" table for exact per-version `changeSummary` text (`docs/SHJ3-wireframes-guide.md`, ~lines 288-314). */
const DEMO_AGENTS: readonly DemoAgent[] = [
  {
    ownerTenant: SEWA,
    name: "SEWA & Utilities Billing Agent",
    slug: "sewa-utilities-billing-agent",
    // B2 gives no free-text description for any of the four agents — left null rather than
    // inventing wizard-step content the brief never specified (same stance `tools/
    // application/seed-demo-data.ts`'s own module comment takes for its scalar config).
    description: null,
    versions: [
      { major: 1, minor: 2, status: "Published", changeSummary: "Initial billing flow" },
      { major: 1, minor: 3, status: "Published", changeSummary: "Tightened guardrail threshold" },
      { major: 1, minor: 4, status: "Published", changeSummary: "Added du/Etisalat lookup tool" },
    ],
    enabledChannelKeys: ["WebWidget", "WhatsApp"] satisfies readonly ChannelKey[],
  },
  {
    ownerTenant: CUSTOMS,
    name: "Customs Enquiry Agent",
    slug: "customs-enquiry-agent",
    description: null,
    versions: [
      { major: 2, minor: 0, status: "Published", changeSummary: "Rebuilt on Graph RAG" },
      { major: 2, minor: 1, status: "Published", changeSummary: "Added declaration status tool" },
    ],
    enabledChannelKeys: ["WebWidget"] satisfies readonly ChannelKey[],
  },
  {
    ownerTenant: LIBRARIES,
    name: "Library Services Agent",
    slug: "library-services-agent",
    description: null,
    // The one seeded agent that stays Draft end to end — a single version, never published,
    // exercising `AgentStatus: "Draft"` and the registry's "—" channels rendering for real.
    versions: [
      { major: 0, minor: 9, status: "Draft", changeSummary: "membership flow in progress" },
    ],
    enabledChannelKeys: [] satisfies readonly ChannelKey[],
  },
  {
    ownerTenant: SHARJAH,
    name: "General FAQ Agent",
    slug: "general-faq-agent",
    description: null,
    versions: [
      { major: 2, minor: 4, status: "Published", changeSummary: "Arabic locale added" },
      {
        major: 3,
        minor: 0,
        status: "Published",
        changeSummary: "Merged entity FAQs into one graph",
      },
    ],
    enabledChannelKeys: ["WebWidget", "WhatsApp"] satisfies readonly ChannelKey[],
  },
];

/** Matches `tests/isolation/setup.ts`'s own real embedding contract rather than a suite-local constant. */
const EMBEDDING_MODEL = process.env.SHJ3_OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-large";
const EMBEDDING_DIMENSIONS = Number(process.env.SHJ3_OPENAI_EMBEDDING_DIM ?? 3072);
const ENVIRONMENT_KEY = process.env.SHJ3_ENVIRONMENT ?? "development";
const SYSTEM_ACTOR: AuditActor = { kind: "System", label: "seed-agents-tools-demo-data" };

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

/** See this file's own module comment — bootstrap work needs *some* ambient tenant bound, and which one is irrelevant as long as one is (mirrors `seed-iam-demo-data.ts`'s identical `runAsBootstrap`). */
function runAsBootstrap<T>(fn: () => Promise<T>): Promise<T> {
  return runWithTenant(
    { tenant: SEWA, principal: null, traceId: newTraceId(), platformScope: "provisioning" },
    fn,
  );
}

function runForTenant<T>(tenant: TenantSlug, fn: () => Promise<T>): Promise<T> {
  return runWithTenant({ tenant, principal: null, traceId: newTraceId() }, fn);
}

/**
 * Like `runForTenant`, but also declares `platformScope: "provisioning"`.
 *
 * `PrismaDemoDataSeeder.ensureAgentWithHistory` (`modules/agents/adapters/outbound/sql/
 * prisma-demo-data-seeder.ts`) resolves `input.ownerTenant`'s row from `getPlatformDb()` (to
 * translate the tenant slug into its platform-schema id) in the same call that also writes
 * to that tenant's own schema via `getTenantDb()` — so this one seed step genuinely needs
 * both an ordinary tenant binding AND platform access in the same context. `getPlatformDb()`
 * refuses any context without a declared `platformScope` at all (ADR-0002 rule 5,
 * `tenant-db.ts`'s own doc comment) — the identical reasoning `seed-system-skins.ts` already
 * documents for its own one-off, `platformScope: "provisioning"` seed run.
 */
function runForTenantAsProvisioning<T>(tenant: TenantSlug, fn: () => Promise<T>): Promise<T> {
  return runWithTenant(
    { tenant, principal: null, traceId: newTraceId(), platformScope: "provisioning" },
    fn,
  );
}

/** Provisions `tenant` across all four stores if it is not already registered — identical guard to `seed-iam-demo-data.ts`'s own (see this file's module comment for why it is duplicated, not imported). */
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
      console.info(
        `[seed-agents-tools-demo-data] tenant "${tenant}" already provisioned — skipping.`,
      );
      return;
    }

    console.info(`[seed-agents-tools-demo-data] provisioning tenant "${tenant}"...`);
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
    console.info(`[seed-agents-tools-demo-data] tenant "${tenant}" provisioned.`);
  });
}

async function main(): Promise<void> {
  for (const tenant of TENANTS) {
    await ensureTenantProvisioned(tenant);
  }

  // ---- B2: the four demo agents + their full version history + channel bindings. ----
  const agentsSeeder = new PrismaAgentsDemoDataSeeder();
  for (const agent of DEMO_AGENTS) {
    const { agentId, currentVersionId } = await runForTenantAsProvisioning(agent.ownerTenant, () =>
      seedAgentWithHistory(agentsSeeder, agent),
    );
    console.info(
      `[seed-agents-tools-demo-data] agent "${agent.name}" (tenant "${agent.ownerTenant}") seeded — ` +
        `agentId=${agentId}, currentVersionId=${currentVersionId}.`,
    );
  }

  // ---- B3 step 4 / B5: skills, MCP servers, API connectors, circuit breakers — ----
  // ---- `sewa`'s full demo catalogue, in the one order `seedCircuitBreakers` requires. ----
  await runForTenant(SEWA, async () => {
    const now = new Date();
    const toolsSeeder = new PrismaToolsDemoDataSeeder();

    await seedSkills(toolsSeeder, now);
    console.info('[seed-agents-tools-demo-data] tenant "sewa": skills seeded.');

    const { sharjahServicesGatewayId } = await seedMcpServers(toolsSeeder, now);
    console.info('[seed-agents-tools-demo-data] tenant "sewa": MCP servers seeded.');

    const { fetchSewaBillConnectorId } = await seedApiConnectors(toolsSeeder, now);
    console.info('[seed-agents-tools-demo-data] tenant "sewa": API connectors seeded.');

    await seedCircuitBreakers(
      {
        seeder: toolsSeeder,
        breakers: new PrismaCircuitBreakerRepository(),
        state: new RedisCircuitBreakerStateStore(),
      },
      { sharjahServicesGatewayId, fetchSewaBillConnectorId },
      now,
    );
    console.info('[seed-agents-tools-demo-data] tenant "sewa": circuit breakers seeded.');
  });

  // ---- The real bug this wave closes: `customs`/`libraries`/`sharjah` had zero skills, ----
  // ---- MCP servers or API connectors — see this file's own module comment above `seedSkills` ----
  // ---- (`modules/tools/application/seed-demo-data.ts`) for the full reasoning. Each tenant ----
  // ---- gets its own smaller, real, domain-appropriate starter catalogue — never `sewa`'s ----
  // ---- bill-payment tools relabelled. No circuit breakers for these three (see that same ----
  // ---- module comment for why). ----
  await runForTenant(CUSTOMS, async () => {
    const now = new Date();
    const toolsSeeder = new PrismaToolsDemoDataSeeder();
    await seedCustomsSkills(toolsSeeder, now);
    await seedCustomsMcpServers(toolsSeeder, now);
    await seedCustomsApiConnectors(toolsSeeder, now);
    console.info('[seed-agents-tools-demo-data] tenant "customs": skills/MCP/connectors seeded.');
  });

  await runForTenant(LIBRARIES, async () => {
    const now = new Date();
    const toolsSeeder = new PrismaToolsDemoDataSeeder();
    await seedLibrariesSkills(toolsSeeder, now);
    await seedLibrariesApiConnectors(toolsSeeder, now);
    console.info('[seed-agents-tools-demo-data] tenant "libraries": skills/connectors seeded.');
  });

  await runForTenant(SHARJAH, async () => {
    const now = new Date();
    const toolsSeeder = new PrismaToolsDemoDataSeeder();
    await seedSharjahSkills(toolsSeeder, now);
    await seedSharjahApiConnectors(toolsSeeder, now);
    console.info('[seed-agents-tools-demo-data] tenant "sharjah": skills/connectors seeded.');
  });

  console.info("[seed-agents-tools-demo-data] done.");
}

main()
  .catch((error: unknown) => {
    console.error("[seed-agents-tools-demo-data] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectAllTenantDbs();
    await disconnectCache();
  });
