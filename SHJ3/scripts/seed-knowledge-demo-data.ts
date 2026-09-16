/**
 * CLI entry point for B-4's deterministic demo data (Knowledge / Graph RAG, B6) — run once
 * per environment, safe to re-run.
 *
 *   pnpm exec tsx scripts/seed-knowledge-demo-data.ts
 *
 * (also wired as `pnpm db:seed:knowledge`.) Mirrors `seed-agents-tools-demo-data.ts`'s own
 * shape and reasoning: a composition root, not application code (constructs concrete
 * adapters directly, which `modules/knowledge/application/` may never do —
 * architecture.md §4's swap test).
 *
 * ## Tenants: reused, not (re-)provisioned
 *
 * `sewa`, `customs`, `libraries`, `sharjah` already exist — provisioned by earlier waves'
 * seed scripts. This script does not call `ProvisionTenant`; it assumes those four schemas
 * are already live and fails loudly (a real `getTenantDb()` error) if one is not, which is
 * the honest behaviour for a script that is not responsible for provisioning.
 *
 * ## SQL only — no live Neo4j/Qdrant writes
 *
 * Every row here is written directly through `modules/knowledge`'s repository ports, never
 * through `AddSource`/the AI client — this script's job is realistic, backoffice-browsable
 * SQL rows, not a populated graph or vector index. The one seeded `Document` source per
 * tenant still gets **real** `Chunk` rows (not a hand-set `indexedPercent` constant):
 * `KnowledgeSources.indexedPercent` is a database-computed column
 * (`TR_Chunks_recountSource`), so the only honest way to seed a nonzero percentage is to
 * insert real `Chunk` rows and mark a realistic subset `Indexed` — which is exactly what
 * `seedDocumentSource` below does, matching FR-KNOW-01's own acceptance criterion
 * ("indexed percentage reflects actual chunk coverage, not a stored constant").
 *
 * ## Duplicates and conflicts: seeded once, in `sewa`/`libraries`
 *
 * The two named duplicate candidates (SEWA ↔ Sharjah Electricity & Water Authority, du ↔ du
 * Telecom) are both utilities/telecom entities, seeded in `sewa` — the tenant every other
 * demo-data seed in this repo treats as the flagship utilities scenario. Of the two named
 * `SourceConflict` scenarios, the straightforward recency one is also `sewa`'s (a SEWA
 * connection-fee figure that legitimately changed between two tariff schedules); the
 * "recency is a trap" scenario is explicitly library-membership, so it is seeded in
 * `libraries` — nothing about splitting them across tenants was specified in the brief, so
 * this placement follows the content itself rather than forcing both into one tenant.
 */

import {
  disconnectAllTenantDbs,
  getTenantDb,
} from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../apps/web/src/modules/platform/adapters/outbound/sql/ulid.js";
import { disconnectCache } from "../apps/web/src/modules/platform/adapters/outbound/cache/tenant-cache.js";
import { runWithTenant } from "../apps/web/src/modules/platform/tenancy/tenant-context.js";
import {
  assertValidSlugShape,
  type TenantSlug,
} from "../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import { PrismaKnowledgeSourceRepository } from "../apps/web/src/modules/knowledge/adapters/outbound/sql/prisma-knowledge-source-repository.js";
import { PrismaChunkRepository } from "../apps/web/src/modules/knowledge/adapters/outbound/sql/prisma-chunk-repository.js";
import { PrismaGraphRepository } from "../apps/web/src/modules/knowledge/adapters/outbound/sql/prisma-graph-repository.js";
import { PrismaRetrievalConfigRepository } from "../apps/web/src/modules/knowledge/adapters/outbound/sql/prisma-retrieval-config-repository.js";
import type { KnowledgeSourceRow } from "../apps/web/src/modules/knowledge/ports/knowledge-source-repository.js";
import type {
  SourceSchedule,
  SourceType,
} from "../apps/web/src/modules/knowledge/domain/knowledge-catalog.js";

const SEWA: TenantSlug = assertValidSlugShape("sewa");
const CUSTOMS: TenantSlug = assertValidSlugShape("customs");
const LIBRARIES: TenantSlug = assertValidSlugShape("libraries");
const SHARJAH: TenantSlug = assertValidSlugShape("sharjah");
const TENANTS: readonly TenantSlug[] = [SEWA, CUSTOMS, LIBRARIES, SHARJAH];

function newTraceId(): string {
  return `seed-knowledge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function runForTenant<T>(tenant: TenantSlug, fn: () => Promise<T>): Promise<T> {
  return runWithTenant({ tenant, principal: null, traceId: newTraceId() }, fn);
}

/** One realistic `Document` source per tenant, with real `Chunk` rows so `indexedPercent` is genuinely trigger-computed, not a stored constant (FR-KNOW-01). ~3 of 4 chunks are marked Indexed — the fourth stays Pending, matching §9.4's "a source is never simply 100% or 0%" honesty rule. */
async function seedDocumentSource(
  chunks: PrismaChunkRepository,
  source: KnowledgeSourceRow,
  now: Date,
  paragraphs: readonly string[],
): Promise<void> {
  let cursor = 0;
  const chunkInputs = paragraphs.map((text, ordinal) => {
    const charStart = cursor;
    cursor += text.length;
    return {
      knowledgeSourceId: source.id,
      knowledgeCollectionId: source.knowledgeCollectionId,
      ordinal,
      text,
      tokenCount: Math.ceil(text.split(/\s+/).length * 1.3),
      charStart,
      charEnd: cursor,
      contentHash: `seed-${source.id}-${ordinal}`,
      sectionPath: null,
      pageNumber: null,
      localeCode: "en",
    };
  });

  const { chunks: created } = await chunks.createDocumentWithChunks({
    document: {
      knowledgeSourceId: source.id,
      externalRef: `seed:${source.id}`,
      title: source.name,
      contentHash: `seed-doc-${source.id}`,
      byteSize: BigInt(paragraphs.join(" ").length),
      mimeType: "text/plain",
      localeCode: "en",
      storageRef: "sql:Chunks(sourceDocumentId)",
      fetchedAt: now,
      supersedesDocumentId: null,
      now,
    },
    chunks: chunkInputs,
  });

  const indexedCount = Math.floor(created.length * 0.75);
  for (const [index, chunk] of created.entries()) {
    if (index < indexedCount) {
      await chunks.applyEmbedResult({
        chunkId: chunk.id,
        vectorState: "Indexed",
        graphState: "Indexed",
        embeddingModel: "text-embedding-3-large",
        embeddingDimension: 3072,
        now,
      });
    }
  }
}

interface SeedResult {
  readonly documentSource: KnowledgeSourceRow;
}

/** The 4-of-5-types, 3-schedules spread the brief asks for, plus real chunk content for the one `Document` source. */
async function seedSourcesForTenant(
  sources: PrismaKnowledgeSourceRepository,
  chunks: PrismaChunkRepository,
  now: Date,
  displayName: string,
): Promise<SeedResult> {
  const collection = await sources.ensureDefaultCollection(now);

  // Idempotency guard, matching every other `scripts/seed-*.ts` file's own "check by
  // natural key before creating" convention (e.g. `seed-channels-demo-data.ts`'s
  // `seedTemplatesAndCampaigns`) — found missing here (this function had none) when a
  // real re-run of `pnpm db:seed:knowledge` against an already-seeded environment failed
  // with a real `UQ_KnowledgeSources_knowledgeCollectionId_name` violation, not assumed.
  const documentSourceName = `${displayName} policy handbook`;
  const alreadySeeded = await sources.listSources();
  const existingDocumentSource = alreadySeeded.find((s) => s.name === documentSourceName);
  if (existingDocumentSource) {
    console.info(
      `[seed-knowledge-demo-data] "${documentSourceName}" already seeded — skipping tenant.`,
    );
    return { documentSource: existingDocumentSource };
  }

  const documentSource = await sources.createSource({
    knowledgeCollectionId: collection.id,
    name: documentSourceName,
    sourceType: "Document" as SourceType,
    location: "Pasted text",
    schedule: "Manual" as SourceSchedule,
    credentialSecretRef: null,
    now,
  });
  await seedDocumentSource(chunks, documentSource, now, [
    `${displayName} publishes its current service catalogue and fee schedule for citizen-facing services. `,
    `Requests are processed within published service-level targets, with escalation available through the contact centre. `,
    `Fees are reviewed annually and published in advance of taking effect. `,
    `Supporting documents must be current and legible at the time of submission.`,
  ]);

  await sources.createSource({
    knowledgeCollectionId: collection.id,
    name: `${displayName}.gov.ae crawler`,
    sourceType: "UrlCrawler" as SourceType,
    location: "https://example.gov.ae",
    schedule: "Weekly" as SourceSchedule,
    credentialSecretRef: null,
    now,
  });

  await sources.createSource({
    knowledgeCollectionId: collection.id,
    name: `${displayName} service catalogue database`,
    sourceType: "Database" as SourceType,
    location: "internal-service-catalogue-db",
    schedule: "Daily" as SourceSchedule,
    credentialSecretRef: "env:SEED_DB_CONN",
    now,
  });

  await sources.createSource({
    knowledgeCollectionId: collection.id,
    name: `${displayName} SharePoint policy library`,
    sourceType: "SharePoint" as SourceType,
    location: "sharepoint://policies",
    schedule: "Manual" as SourceSchedule,
    credentialSecretRef: "env:SEED_SHAREPOINT_TOKEN",
    now,
  });

  return { documentSource };
}

/** The two named duplicate candidates — `sewa`-tenant, both utilities/telecom entities. */
async function seedDuplicateCandidates(graph: PrismaGraphRepository, now: Date): Promise<void> {
  const sewa = await graph.upsertNode({
    label: "Provider",
    canonicalKey: "sewa",
    canonicalName: "SEWA",
    origin: "Extracted",
    authoredByStaffUserId: null,
    firstSeenChunkId: null,
    now,
  });
  const sewaAuthority = await graph.upsertNode({
    label: "Provider",
    canonicalKey: "sharjah-electricity-water-authority",
    canonicalName: "Sharjah Electricity & Water Authority",
    origin: "Extracted",
    authoredByStaffUserId: null,
    firstSeenChunkId: null,
    now,
  });
  await graph.upsertDuplicateCandidate({
    leftNodeRecordId: sewa.id,
    rightNodeRecordId: sewaAuthority.id,
    similarity: 0.93,
    detectionMethod: "AliasOverlap",
    now,
  });

  const du = await graph.upsertNode({
    label: "Provider",
    canonicalKey: "du",
    canonicalName: "du",
    origin: "Extracted",
    authoredByStaffUserId: null,
    firstSeenChunkId: null,
    now,
  });
  const duTelecom = await graph.upsertNode({
    label: "Provider",
    canonicalKey: "du-telecom",
    canonicalName: "du Telecom",
    origin: "Extracted",
    authoredByStaffUserId: null,
    firstSeenChunkId: null,
    now,
  });
  await graph.upsertDuplicateCandidate({
    leftNodeRecordId: du.id,
    rightNodeRecordId: duTelecom.id,
    similarity: 0.88,
    detectionMethod: "NormalizedName",
    now,
  });
}

/** The straightforward-recency conflict (FR-KNOW-18/21) — `sewa` tenant. */
async function seedSewaConflict(
  graph: PrismaGraphRepository,
  chunks: PrismaChunkRepository,
  sources: PrismaKnowledgeSourceRepository,
  now: Date,
): Promise<void> {
  const collection = await sources.ensureDefaultCollection(now);

  // Idempotency guard — see `seedSourcesForTenant`'s identical fix for why this was
  // missing and what it was found to break on a real re-run.
  const sideAName = "SEWA tariff schedule (2025)";
  if ((await sources.listSources()).some((s) => s.name === sideAName)) {
    console.info(`[seed-knowledge-demo-data] "${sideAName}" already seeded — skipping.`);
    return;
  }

  const sideASource = await sources.createSource({
    knowledgeCollectionId: collection.id,
    name: sideAName,
    sourceType: "Document",
    location: "Pasted text",
    schedule: "Manual",
    credentialSecretRef: null,
    now,
  });
  const sideBSource = await sources.createSource({
    knowledgeCollectionId: collection.id,
    name: "SEWA tariff schedule (2026)",
    sourceType: "Document",
    location: "Pasted text",
    schedule: "Manual",
    credentialSecretRef: null,
    now,
  });
  const { chunks: sideAChunks } = await chunks.createDocumentWithChunks({
    document: {
      knowledgeSourceId: sideASource.id,
      externalRef: "seed:conflict-sewa-a",
      title: sideASource.name,
      contentHash: "seed-conflict-sewa-a",
      byteSize: 64n,
      mimeType: "text/plain",
      localeCode: "en",
      storageRef: "sql:Chunks(sourceDocumentId)",
      fetchedAt: now,
      supersedesDocumentId: null,
      now,
    },
    chunks: [
      {
        knowledgeSourceId: sideASource.id,
        knowledgeCollectionId: collection.id,
        ordinal: 0,
        text: "The SEWA new-connection fee is AED 110.",
        tokenCount: 8,
        charStart: 0,
        charEnd: 40,
        contentHash: "seed-conflict-sewa-a-0",
        sectionPath: null,
        pageNumber: null,
        localeCode: "en",
      },
    ],
  });
  const { chunks: sideBChunks } = await chunks.createDocumentWithChunks({
    document: {
      knowledgeSourceId: sideBSource.id,
      externalRef: "seed:conflict-sewa-b",
      title: sideBSource.name,
      contentHash: "seed-conflict-sewa-b",
      byteSize: 64n,
      mimeType: "text/plain",
      localeCode: "en",
      storageRef: "sql:Chunks(sourceDocumentId)",
      fetchedAt: now,
      supersedesDocumentId: null,
      now,
    },
    chunks: [
      {
        knowledgeSourceId: sideBSource.id,
        knowledgeCollectionId: collection.id,
        ordinal: 0,
        text: "The SEWA new-connection fee is AED 130.",
        tokenCount: 8,
        charStart: 0,
        charEnd: 40,
        contentHash: "seed-conflict-sewa-b-0",
        sectionPath: null,
        pageNumber: null,
        localeCode: "en",
      },
    ],
  });

  const feeNode = await graph.upsertNode({
    label: "Fee",
    canonicalKey: "sewa-connection-fee",
    canonicalName: "SEWA connection fee",
    origin: "Extracted",
    authoredByStaffUserId: null,
    firstSeenChunkId: sideAChunks[0].id,
    now,
  });

  await seedConflictRow({
    topic: "SEWA connection fee",
    graphNodeRecordId: feeNode.id,
    graphEntityKey: feeNode.canonicalKey,
    sideAChunkId: sideAChunks[0].id,
    sideAKnowledgeSourceId: sideASource.id,
    sideAValue: "AED 110",
    sideASourceUpdatedAt: new Date("2025-06-01T00:00:00.000Z"),
    sideBChunkId: sideBChunks[0].id,
    sideBKnowledgeSourceId: sideBSource.id,
    sideBValue: "AED 130",
    sideBSourceUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    now,
  });
}

/** The "recency is a trap" conflict (FR-KNOW-19/22) — `libraries` tenant. The more recent source (a third-party FAQ) holds the LESS authoritative value; only `PreferOwningEntitySource`/`AlwaysAskAdmin` get this right. */
async function seedLibrariesConflict(
  graph: PrismaGraphRepository,
  chunks: PrismaChunkRepository,
  sources: PrismaKnowledgeSourceRepository,
  now: Date,
): Promise<void> {
  const collection = await sources.ensureDefaultCollection(now);

  // Idempotency guard — see `seedSourcesForTenant`'s identical fix for why this was
  // missing and what it was found to break on a real re-run.
  const sideAName = "Sharjah Libraries policy handbook (2024)";
  if ((await sources.listSources()).some((s) => s.name === sideAName)) {
    console.info(`[seed-knowledge-demo-data] "${sideAName}" already seeded — skipping.`);
    return;
  }

  const sideASource = await sources.createSource({
    knowledgeCollectionId: collection.id,
    name: sideAName,
    sourceType: "Document",
    location: "Pasted text",
    schedule: "Manual",
    credentialSecretRef: null,
    now,
  });
  const sideBSource = await sources.createSource({
    knowledgeCollectionId: collection.id,
    name: "Third-party community FAQ (2026)",
    sourceType: "Document",
    location: "Pasted text",
    schedule: "Manual",
    credentialSecretRef: null,
    now,
  });
  const { chunks: sideAChunks } = await chunks.createDocumentWithChunks({
    document: {
      knowledgeSourceId: sideASource.id,
      externalRef: "seed:conflict-lib-a",
      title: sideASource.name,
      contentHash: "seed-conflict-lib-a",
      byteSize: 96n,
      mimeType: "text/plain",
      localeCode: "en",
      storageRef: "sql:Chunks(sourceDocumentId)",
      fetchedAt: now,
      supersedesDocumentId: null,
      now,
    },
    chunks: [
      {
        knowledgeSourceId: sideASource.id,
        knowledgeCollectionId: collection.id,
        ordinal: 0,
        text: "Students are exempt from the annual library membership fee.",
        tokenCount: 10,
        charStart: 0,
        charEnd: 60,
        contentHash: "seed-conflict-lib-a-0",
        sectionPath: null,
        pageNumber: null,
        localeCode: "en",
      },
    ],
  });
  const { chunks: sideBChunks } = await chunks.createDocumentWithChunks({
    document: {
      knowledgeSourceId: sideBSource.id,
      externalRef: "seed:conflict-lib-b",
      title: sideBSource.name,
      contentHash: "seed-conflict-lib-b",
      byteSize: 96n,
      mimeType: "text/plain",
      localeCode: "en",
      storageRef: "sql:Chunks(sourceDocumentId)",
      fetchedAt: now,
      supersedesDocumentId: null,
      now,
    },
    chunks: [
      {
        knowledgeSourceId: sideBSource.id,
        knowledgeCollectionId: collection.id,
        ordinal: 0,
        text: "All members pay the standard membership fee; no exemptions apply.",
        tokenCount: 11,
        charStart: 0,
        charEnd: 66,
        contentHash: "seed-conflict-lib-b-0",
        sectionPath: null,
        pageNumber: null,
        localeCode: "en",
      },
    ],
  });

  const policyNode = await graph.upsertNode({
    label: "Fee",
    canonicalKey: "library-membership-fee-waiver",
    canonicalName: "Library membership fee waiver eligibility",
    origin: "Extracted",
    authoredByStaffUserId: null,
    firstSeenChunkId: sideAChunks[0].id,
    now,
  });

  await seedConflictRow({
    topic: "Library membership fee waiver eligibility",
    graphNodeRecordId: policyNode.id,
    graphEntityKey: policyNode.canonicalKey,
    sideAChunkId: sideAChunks[0].id,
    sideAKnowledgeSourceId: sideASource.id,
    sideAValue: "Students exempt from membership fee",
    sideASourceUpdatedAt: new Date("2024-01-01T00:00:00.000Z"),
    sideBChunkId: sideBChunks[0].id,
    sideBKnowledgeSourceId: sideBSource.id,
    sideBValue: "All members pay standard fee, no exemptions",
    sideBSourceUpdatedAt: new Date("2026-03-01T00:00:00.000Z"),
    now,
  });
}

interface ConflictSeedInput {
  readonly topic: string;
  readonly graphNodeRecordId: string;
  readonly graphEntityKey: string;
  readonly sideAChunkId: string;
  readonly sideAKnowledgeSourceId: string;
  readonly sideAValue: string;
  readonly sideASourceUpdatedAt: Date;
  readonly sideBChunkId: string;
  readonly sideBKnowledgeSourceId: string;
  readonly sideBValue: string;
  readonly sideBSourceUpdatedAt: Date;
  readonly now: Date;
}

/**
 * `ConflictRepository` (the application-facing port) exposes `list`/`get`/`resolve` only —
 * deliberately no `create`, since detection (not seeding) is meant to be the only writer in
 * production. This seed script is the one sanctioned exception (fixture data standing in
 * for a detection pipeline this wave does not build), so it reaches one level below the
 * port, onto `getTenantDb()` directly, exactly the way every other composition-root seed
 * script in this repo is allowed to (`modules/agents/adapters/outbound/sql/prisma-demo-data-
 * seeder.ts`'s own precedent for reaching past an application-facing port for fixture-only
 * writes).
 */
async function seedConflictRow(input: ConflictSeedInput): Promise<void> {
  // `getTenantDb`/`newUlid` are imported statically at module top now — they were
  // originally dynamic `await import(...)` calls here, which is what actually broke:
  // found live, against this exact script, hitting `MissingTenantContextError` even
  // though this function only ever runs inside `runForTenant(...)`'s bound callback.
  // Node's dynamic `import()` resolves via its own microtask scheduling, and confirmed
  // empirically (re-running with a static import fixed it, matching this project's own
  // AsyncLocalStorage-boundary lesson in tasks/lessons.md) that the resolved module
  // namespace's *use* here was landing outside the AsyncLocalStorage-bound continuation
  // the surrounding `runWithTenant()` call established — the same family of gotcha, one
  // more shape of it. Static imports carry no such risk: they resolve before `main()`
  // ever runs, long before any `runWithTenant()` call exists.
  const db = getTenantDb("seed-knowledge-demo-data.seedConflictRow");
  await db.sourceConflict.create({
    data: {
      id: newUlid(input.now),
      topic: input.topic,
      graphNodeRecordId: input.graphNodeRecordId,
      graphEntityKey: input.graphEntityKey,
      sideAChunkId: input.sideAChunkId,
      sideAKnowledgeSourceId: input.sideAKnowledgeSourceId,
      sideAValue: input.sideAValue,
      sideASourceUpdatedAt: input.sideASourceUpdatedAt,
      sideBChunkId: input.sideBChunkId,
      sideBKnowledgeSourceId: input.sideBKnowledgeSourceId,
      sideBValue: input.sideBValue,
      sideBSourceUpdatedAt: input.sideBSourceUpdatedAt,
      detectedAt: input.now,
      detectionMethod: "Manual",
      status: "Open",
      policyAtDetection: "PreferMostRecentlyUpdated",
      authoritativeSide: null,
      resolvedByStaffUserId: null,
      resolvedAt: null,
      groundingPenalty: 0.25,
      createdAt: input.now,
      updatedAt: input.now,
    },
  });
}

const TENANT_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  [SEWA]: "SEWA",
  [CUSTOMS]: "Sharjah Customs",
  [LIBRARIES]: "Sharjah Libraries",
  [SHARJAH]: "Sharjah (Platform)",
};

async function main(): Promise<void> {
  const now = new Date();

  for (const tenant of TENANTS) {
    await runForTenant(tenant, async () => {
      const sources = new PrismaKnowledgeSourceRepository();
      const chunks = new PrismaChunkRepository();
      const retrievalConfig = new PrismaRetrievalConfigRepository();

      await retrievalConfig.ensureTenantConfig(now);
      await seedSourcesForTenant(sources, chunks, now, TENANT_DISPLAY_NAMES[tenant] ?? tenant);
      console.info(
        `[seed-knowledge-demo-data] tenant "${tenant}": collection, config and 4 sources seeded.`,
      );
    });
  }

  await runForTenant(SEWA, async () => {
    const graph = new PrismaGraphRepository();
    const chunks = new PrismaChunkRepository();
    const sources = new PrismaKnowledgeSourceRepository();

    await seedDuplicateCandidates(graph, now);
    console.info('[seed-knowledge-demo-data] tenant "sewa": duplicate candidates seeded.');

    await seedSewaConflict(graph, chunks, sources, now);
    console.info('[seed-knowledge-demo-data] tenant "sewa": recency-conflict scenario seeded.');
  });

  await runForTenant(LIBRARIES, async () => {
    const graph = new PrismaGraphRepository();
    const chunks = new PrismaChunkRepository();
    const sources = new PrismaKnowledgeSourceRepository();

    await seedLibrariesConflict(graph, chunks, sources, now);
    console.info(
      '[seed-knowledge-demo-data] tenant "libraries": recency-is-a-trap conflict scenario seeded.',
    );
  });

  console.info("[seed-knowledge-demo-data] done.");
}

main()
  .catch((error: unknown) => {
    console.error("[seed-knowledge-demo-data] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectAllTenantDbs();
    await disconnectCache();
  });
