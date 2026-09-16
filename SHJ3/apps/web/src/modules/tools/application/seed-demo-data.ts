/**
 * The application-layer half of the deterministic demo-data seed for `tools` —
 * mirrors `iam/application/seed-demo-data.ts`'s shape and reasoning exactly.
 * Read that file's own doc comment for why these are several small,
 * single-tenant-scoped functions rather than one looping orchestrator:
 * `getTenantDb()`/`getTenantCache()` resolve their schema/keyspace from the
 * *ambient* bound tenant, not a parameter, so a single ambient binding cannot
 * correctly serve calls meant for several different tenants in the same loop.
 * Each function here assumes its caller has already bound the correct tenant
 * context (`runWithTenant`) — the future top-level seed script is what loops
 * and re-binds between tenants, never this file (`runWithTenant` must not be
 * called from a feature module — `tenant-context.ts`'s own doc comment).
 *
 * `seedSkills`/`seedMcpServers`/`seedApiConnectors`/`seedCircuitBreakers` are
 * `sewa`-tenant-scoped, transcribed exactly from `docs/SHJ3-wireframes-guide.md`'s
 * B3 step 4 and B5 sections (the skills table, the MCP servers table with its
 * bindable pills, the API connectors table, and the breakers table).
 *
 * ## `sharjah`/`customs`/`libraries` had zero rows here — a real bug, not a gap by design
 *
 * Confirmed live: `sewa` had 33 skills / 2 MCP servers / 2 API connectors; the other three
 * tenants had 0/0/0, because `scripts/seed-agents-tools-demo-data.ts` only ever called this
 * file's seed functions inside a `sewa`-bound context. This is the exact same systemic
 * pattern already fixed once this session for `Channel` rows
 * (`ProvisionDefaultChannelsForTenant`'s own doc comment) — a demo/fixture seed script was
 * the only place a tenant-scoped catalogue was ever populated, for one hardcoded tenant.
 *
 * Unlike `Channel` rows, though, skills/MCP servers/API connectors are not a fixed, identical
 * four-row catalogue every tenant needs — they are genuinely tenant-domain-specific (a
 * customs declaration lookup is meaningless to a library membership agent), so the fix here
 * is a *seed script* extension (real, plausible, non-fabricated-credential starter content
 * per tenant's own real government-service domain), not a structural `ProvisionTenant` hook
 * the way `Channel` rows were. `seedCustomsSkills`/`seedCustomsMcpServers`/
 * `seedCustomsApiConnectors`, `seedLibrariesSkills`/`seedLibrariesApiConnectors`, and
 * `seedSharjahSkills`/`seedSharjahApiConnectors` below are each real, idempotent (`ensure*`),
 * tenant-appropriate starter catalogues — deliberately smaller than `sewa`'s own 33/2/2 (that
 * one is this project's fully-fledged demo tenant; these three only need enough that the
 * agent wizard's "Skills & tools" step is never empty for a real admin). Every MCP
 * server/API connector endpoint below is a real-looking, non-functional URL under this
 * project's own `*.shj.ae` domain convention with a real `env:`-prefixed secret reference —
 * never a fabricated live third-party credential, matching this same session's WhatsApp
 * BSP-credential precedent exactly. No circuit breakers are seeded for these three tenants:
 * B5 tab 4 never creates one through its own UI (only edits/resets/trips an existing one,
 * `ports/demo-data-seeder.ts`'s own module comment), and nothing in this fix's own brief
 * requires manufacturing one.
 *
 * No `boundByStaffUserId`-style attribution constant is needed anywhere in this
 * file: none of `SkillRow`/`McpServerRow`/`McpToolRow`/`ApiConnectorRow`/
 * `CircuitBreakerConfigRow` carry an actor field, no `ToolBinding` rows are
 * seeded here (there is no real `AgentVersion` yet to bind them to — that is
 * `agents`' own seed script's concern, built in parallel), and the one
 * `CircuitBreakerEvent` this file appends (the seeded-Open SEWA bill API
 * breaker) is an automatic `ThresholdBreached` transition, whose
 * `actorStaffUserId` is `null` by the brief's own specification — never a
 * synthetic system-seed actor.
 */

import { breakerRef } from "../domain/circuit-breaker.js";
import type { CircuitBreakerRepository } from "../ports/circuit-breaker-repository.js";
import type { CircuitBreakerStateStore } from "../ports/circuit-breaker-state-store.js";
import type { DemoDataSeeder, NewCircuitBreakerSeed } from "../ports/demo-data-seeder.js";

interface NativeSkillPlan {
  readonly name: string;
  readonly isAttachedByDefault: boolean;
}

/** Shared by every tenant's skill seed below — each is a real, in-app-logic native skill
 *  (never a third-party credential), so defaulting one is safe the same way `WidgetConfig`'s
 *  defaults are (`ProvisionDefaultChannelsForTenant`'s own doc comment). */
async function seedNativeSkills(
  seeder: DemoDataSeeder,
  now: Date,
  skills: readonly NativeSkillPlan[],
): Promise<void> {
  for (const skill of skills) {
    await seeder.ensureNativeSkill(
      {
        name: skill.name,
        description: null,
        category: null,
        inputSchemaJson: "{}",
        isAttachedByDefault: skill.isAttachedByDefault,
      },
      now,
    );
  }
}

/** B3 step 4 sub-tab A / B5 tab 1's four sample skills, transcribed exactly. Call under `runWithTenant({tenant: sewa, ...})`. */
export async function seedSkills(seeder: DemoDataSeeder, now: Date): Promise<void> {
  await seedNativeSkills(seeder, now, [
    { name: "Fetch SEWA bill", isAttachedByDefault: true },
    { name: "Fetch Etisalat/du bill", isAttachedByDefault: true },
    { name: "Escalate to live agent", isAttachedByDefault: true },
    { name: "Book Jawaher Centre slot", isAttachedByDefault: false },
  ]);
}

/** Sharjah Customs' own starter skill set (real declaration/duty domain, not SEWA's
 *  bill-payment tools). Call under `runWithTenant({tenant: customs, ...})`. */
export async function seedCustomsSkills(seeder: DemoDataSeeder, now: Date): Promise<void> {
  await seedNativeSkills(seeder, now, [
    { name: "Check declaration status", isAttachedByDefault: true },
    { name: "Escalate to live agent", isAttachedByDefault: true },
    { name: "Fetch customs duty schedule", isAttachedByDefault: false },
  ]);
}

/** Sharjah Libraries' own starter skill set (membership/loans domain). Call under
 *  `runWithTenant({tenant: libraries, ...})`. */
export async function seedLibrariesSkills(seeder: DemoDataSeeder, now: Date): Promise<void> {
  await seedNativeSkills(seeder, now, [
    { name: "Check membership status", isAttachedByDefault: true },
    { name: "Escalate to live agent", isAttachedByDefault: true },
    { name: "Renew a loan", isAttachedByDefault: false },
  ]);
}

/** The platform-operator `sharjah` tenant's own starter skill set — General FAQ's real job
 *  is estate-wide wayfinding (`docs/SHJ3-wireframes-guide.md`'s own "Handles broad wayfinding
 *  questions" note), not any single entity's transactional tools. Call under
 *  `runWithTenant({tenant: sharjah, ...})`. */
export async function seedSharjahSkills(seeder: DemoDataSeeder, now: Date): Promise<void> {
  await seedNativeSkills(seeder, now, [
    { name: "Escalate to live agent", isAttachedByDefault: true },
    { name: "Search government services directory", isAttachedByDefault: true },
  ]);
}

export interface SeedMcpServersResult {
  /** The circuit breaker seed below binds "Sharjah Services Gateway (MCP)" to this id. */
  readonly sharjahServicesGatewayId: string;
}

/** B3 step 4 sub-tab B / B5 tab 2's two sample MCP servers. Call under `runWithTenant({tenant: sewa, ...})`. */
export async function seedMcpServers(
  seeder: DemoDataSeeder,
  now: Date,
): Promise<SeedMcpServersResult> {
  const sharjahServicesGatewayId = await seeder.ensureMcpServer(
    {
      name: "Sharjah Services Gateway",
      endpoint: "mcp://sharjah-services.internal",
      transport: "StreamableHttp",
      authMode: "OAuth2ClientCredentials",
      credentialSecretRef: "env:MCP_SHARJAH_SERVICES_TOKEN",
      discoveredTools: [
        { name: "get_bill_status", description: null, inputSchemaJson: "{}" },
        { name: "create_payment_link", description: null, inputSchemaJson: "{}" },
        { name: "list_service_centres", description: null, inputSchemaJson: "{}" },
        { name: "cancel_booking", description: null, inputSchemaJson: "{}" },
      ],
    },
    now,
  );

  // "Sharjah Customs MCP" — seeded NotConnected, no discovered tools: matches
  // the wireframe exactly ("Not connected"). Its id is not needed by any later
  // seed step, so it is not returned.
  await seeder.ensureMcpServer(
    {
      name: "Sharjah Customs MCP",
      endpoint: "mcp://customs.shj.ae",
      transport: "StreamableHttp",
      authMode: "MutualTls",
      credentialSecretRef: "env:MCP_CUSTOMS_CERT",
      discoveredTools: [],
    },
    now,
  );

  return { sharjahServicesGatewayId };
}

export interface SeedApiConnectorsResult {
  /** The circuit breaker seed below binds "SEWA bill API" to this id. */
  readonly fetchSewaBillConnectorId: string;
}

/** B3 step 4 sub-tab C / B5 tab 3's two sample API connectors. Call under `runWithTenant({tenant: sewa, ...})`. */
export async function seedApiConnectors(
  seeder: DemoDataSeeder,
  now: Date,
): Promise<SeedApiConnectorsResult> {
  const fetchSewaBillConnectorId = await seeder.ensureApiConnector(
    {
      name: "Fetch SEWA bill",
      method: "GET",
      urlTemplate: "https://api.sewa.ae/v1/bills/{account}",
      authMode: "ApiKey",
      credentialSecretRef: "env:SEWA_BILL_API_KEY",
      timeoutMs: 10_000,
      rateLimitPolicy: {
        name: "sewa-bill-api-default",
        requestsPerWindow: 100,
        windowSeconds: 60,
        burst: 10,
        scope: "PerTenant",
      },
      seededSampleResponseJson:
        '{"accountNumber":"1234567","balance":245.50,"dueDate":"2026-09-20"}',
    },
    now,
  );

  // "Create payment link" — seeded Untested: matches the wireframe exactly, so
  // no seededSampleResponseJson is passed. Its id is not needed by any later
  // seed step, so it is not returned.
  await seeder.ensureApiConnector(
    {
      name: "Create payment link",
      method: "POST",
      urlTemplate: "https://pay.shj.ae/v1/links",
      authMode: "OAuth2ClientCredentials",
      credentialSecretRef: "env:PAY_SHJ_CLIENT_SECRET",
      timeoutMs: 15_000,
      rateLimitPolicy: {
        name: "pay-shj-links-default",
        requestsPerWindow: 100,
        windowSeconds: 60,
        burst: 10,
        scope: "PerTenant",
      },
    },
    now,
  );

  return { fetchSewaBillConnectorId };
}

/**
 * Sharjah Customs' own MCP server — the same real endpoint/authMode/credential-reference
 * shape `seedMcpServers` above already seeds under `sewa`'s catalogue (matching the
 * wireframe's own "Sharjah Customs MCP | mcp://customs.shj.ae | mTLS | Not connected" row),
 * now seeded where it actually belongs too: the `customs` tenant's own tool registry, not
 * only visible from `sewa`'s. Call under `runWithTenant({tenant: customs, ...})`.
 */
export async function seedCustomsMcpServers(seeder: DemoDataSeeder, now: Date): Promise<void> {
  await seeder.ensureMcpServer(
    {
      name: "Sharjah Customs MCP",
      endpoint: "mcp://customs.shj.ae",
      transport: "StreamableHttp",
      authMode: "MutualTls",
      credentialSecretRef: "env:MCP_CUSTOMS_CERT",
      discoveredTools: [],
    },
    now,
  );
}

/** Sharjah Customs' own starter API connector — declaration-status lookup, seeded
 *  `Untested` (no sandbox credentials exist in this environment, matching `sewa`'s own
 *  "Create payment link" precedent). Call under `runWithTenant({tenant: customs, ...})`. */
export async function seedCustomsApiConnectors(seeder: DemoDataSeeder, now: Date): Promise<void> {
  await seeder.ensureApiConnector(
    {
      name: "Customs declaration status",
      method: "GET",
      urlTemplate: "https://api.customs.shj.ae/v1/declarations/{reference}",
      authMode: "ApiKey",
      credentialSecretRef: "env:CUSTOMS_DECLARATIONS_API_KEY",
      timeoutMs: 10_000,
      rateLimitPolicy: {
        name: "customs-declarations-api-default",
        requestsPerWindow: 100,
        windowSeconds: 60,
        burst: 10,
        scope: "PerTenant",
      },
    },
    now,
  );
}

/** Sharjah Libraries' own starter API connector — catalogue availability lookup, seeded
 *  `Untested` for the same reason as `seedCustomsApiConnectors`. Call under
 *  `runWithTenant({tenant: libraries, ...})`. */
export async function seedLibrariesApiConnectors(seeder: DemoDataSeeder, now: Date): Promise<void> {
  await seeder.ensureApiConnector(
    {
      name: "Library catalogue availability",
      method: "GET",
      urlTemplate: "https://api.libraries.shj.ae/v1/catalogue/{isbn}",
      authMode: "ApiKey",
      credentialSecretRef: "env:LIBRARIES_CATALOGUE_API_KEY",
      timeoutMs: 10_000,
      rateLimitPolicy: {
        name: "libraries-catalogue-api-default",
        requestsPerWindow: 100,
        windowSeconds: 60,
        burst: 10,
        scope: "PerTenant",
      },
    },
    now,
  );
}

/** The platform-operator `sharjah` tenant's own starter API connector — a government
 *  services directory search, matching General FAQ's real wayfinding job. Seeded
 *  `Untested` for the same reason as the other two tenants above. Call under
 *  `runWithTenant({tenant: sharjah, ...})`. */
export async function seedSharjahApiConnectors(seeder: DemoDataSeeder, now: Date): Promise<void> {
  await seeder.ensureApiConnector(
    {
      name: "Sharjah services directory search",
      method: "GET",
      urlTemplate: "https://api.shj.ae/v1/services/directory?query={query}",
      authMode: "ApiKey",
      credentialSecretRef: "env:SHJ_SERVICES_DIRECTORY_API_KEY",
      timeoutMs: 10_000,
      rateLimitPolicy: {
        name: "shj-services-directory-default",
        requestsPerWindow: 100,
        windowSeconds: 60,
        burst: 10,
        scope: "PerTenant",
      },
    },
    now,
  );
}

export interface SeedCircuitBreakersDeps {
  readonly seeder: DemoDataSeeder;
  readonly breakers: CircuitBreakerRepository;
  readonly state: CircuitBreakerStateStore;
}

export interface SeedCircuitBreakersInput {
  readonly sharjahServicesGatewayId: string;
  readonly fetchSewaBillConnectorId: string;
}

/**
 * B5 tab 4's three sample circuit breakers. Depends on the MCP server and API
 * connector ids `seedMcpServers`/`seedApiConnectors` already created — call
 * this after both, in the same `runWithTenant({tenant: sewa, ...})` binding.
 *
 * Live Redis state and the durable SQL ledger are both written here for the
 * seeded-Open breaker, matching `ResetCircuitBreaker`/`TripCircuitBreaker`'s own
 * "both must happen" rule — except this is bootstrap fixture data, not a real
 * manual action, so its ledger event uses `reason: "ThresholdBreached"`
 * (automatic, `actorStaffUserId: null`) rather than `"ManualTrip"`, matching
 * what a real threshold breach would actually have written.
 */
export async function seedCircuitBreakers(
  deps: SeedCircuitBreakersDeps,
  input: SeedCircuitBreakersInput,
  now: Date,
): Promise<void> {
  const { seeder, breakers, state } = deps;
  const degradedModeMessage =
    "Some services are slow right now — I can still answer questions, but payments may be delayed.";

  // "SEWA bill API" — the wireframe's explicitly-called-out seeded-Open breaker,
  // matching B14 tab 3's observability screen.
  const sewaBillSeed: NewCircuitBreakerSeed = {
    targetKind: "ApiConnector",
    targetId: input.fetchSewaBillConnectorId,
    targetKey: null,
    failureThreshold: 5,
    windowSeconds: 60,
    cooldownSeconds: 120,
    halfOpenProbes: 1,
    fallbackStrategy: "ApologiseOfferLiveAgent",
    cachedAnswerMaxAgeSeconds: null,
    serveCachedWhenDown: false,
    degradedModeMessage,
    isEnabled: true,
  };
  // `ensureCircuitBreaker` is create-or-find (idempotent), but `CircuitBreakerEvent` is an
  // append-only ledger with no such guard on `appendEvent` itself — a re-run that always
  // appended would leave a growing trail of duplicate "ThresholdBreached" events for the
  // same breaker every time this seed runs. So the ledger write (and the live-state write
  // that narrates it) only happens the first time this breaker is actually created; on every
  // later run `ensureCircuitBreaker` finds the existing row and this seed leaves its
  // already-seeded event/state alone, exactly like every other `ensure*` step in this file.
  const existingSewaBillBreaker = (await breakers.list()).find(
    (row) =>
      row.targetKind === sewaBillSeed.targetKind &&
      row.targetId === sewaBillSeed.targetId &&
      row.targetKey === sewaBillSeed.targetKey,
  );
  const sewaBillBreakerId = await seeder.ensureCircuitBreaker(sewaBillSeed, now);
  if (!existingSewaBillBreaker) {
    const sewaBillRef = breakerRef({
      targetId: sewaBillSeed.targetId,
      targetKey: sewaBillSeed.targetKey,
    });
    await state.setState("ApiConnector", sewaBillRef, {
      state: "Open",
      openedAt: now,
      cooldownUntil: new Date(now.getTime() + sewaBillSeed.cooldownSeconds * 1000),
      consecutiveProbeFailures: 5,
    });
    await breakers.appendEvent({
      circuitBreakerConfigId: sewaBillBreakerId,
      transition: "Open",
      reason: "ThresholdBreached",
      failureCount: 5,
      actorStaffUserId: null,
      now,
    });
  }

  // "Sharjah Services Gateway (MCP)" — seeded Closed/healthy, written explicitly
  // for a fully deterministic seed (a missing Redis key already reads back as
  // closed by convention, per CircuitBreakerStateStore.getState's own doc
  // comment, but an explicit write removes any doubt for this seed run).
  const gatewaySeed: NewCircuitBreakerSeed = {
    targetKind: "McpServer",
    targetId: input.sharjahServicesGatewayId,
    targetKey: null,
    failureThreshold: 5,
    windowSeconds: 60,
    cooldownSeconds: 120,
    halfOpenProbes: 1,
    fallbackStrategy: "ServeCachedAnswer",
    cachedAnswerMaxAgeSeconds: 86_400,
    serveCachedWhenDown: true,
    degradedModeMessage,
    isEnabled: true,
  };
  await seeder.ensureCircuitBreaker(gatewaySeed, now);
  await state.setState(
    "McpServer",
    breakerRef({ targetId: gatewaySeed.targetId, targetKey: gatewaySeed.targetKey }),
    {
      state: "Closed",
      openedAt: null,
      cooldownUntil: null,
      consecutiveProbeFailures: 0,
    },
  );

  // "WhatsApp BSP" — the one breaker using the targetKey discriminator: no real
  // Channel row exists yet (B10 territory, not built in this wave).
  const whatsAppSeed: NewCircuitBreakerSeed = {
    targetKind: "Channel",
    targetId: null,
    targetKey: "whatsapp_bsp",
    failureThreshold: 10,
    windowSeconds: 60,
    cooldownSeconds: 300,
    halfOpenProbes: 1,
    fallbackStrategy: "QueueAndRetry",
    cachedAnswerMaxAgeSeconds: null,
    serveCachedWhenDown: false,
    degradedModeMessage,
    isEnabled: true,
  };
  await seeder.ensureCircuitBreaker(whatsAppSeed, now);
  await state.setState(
    "Channel",
    breakerRef({ targetId: whatsAppSeed.targetId, targetKey: whatsAppSeed.targetKey }),
    {
      state: "Closed",
      openedAt: null,
      cooldownUntil: null,
      consecutiveProbeFailures: 0,
    },
  );
}
