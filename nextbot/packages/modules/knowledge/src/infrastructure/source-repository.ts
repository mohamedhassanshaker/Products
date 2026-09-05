import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { KnowledgeAcl, KnowledgeSourceFailure, KnowledgeSourceLocator } from "@nextbot/db";
import { KnowledgeSourceNotFoundError } from "@nextbot/contracts";

export type KnowledgeSourceRow = typeof schema.knowledgeSource.$inferSelect;

export interface CreateSourceInput {
  collectionId: string;
  kind: "Upload" | "Url" | "McpResource" | "Connector";
  name: string;
  locator: KnowledgeSourceLocator;
  acl: KnowledgeAcl;
  aclTags: string[];
  syncIntervalSeconds?: number | null;
}

export async function createSource(ctx: TenantContext, input: CreateSourceInput): Promise<KnowledgeSourceRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const id = generateId();
    await db.insert(schema.knowledgeSource).values({
      id,
      tenantId: ctx.tenantId,
      collectionId: input.collectionId,
      kind: input.kind,
      name: input.name,
      locator: input.locator,
      aclJson: input.acl,
      aclTags: input.aclTags,
      syncIntervalSeconds: input.syncIntervalSeconds,
    });
    const [row] = await db.select().from(schema.knowledgeSource).where(eq(schema.knowledgeSource.id, id));
    if (!row) throw new Error("createSource: insert did not return a row");
    return row as KnowledgeSourceRow;
  });
}

export async function listSourcesForCollection(ctx: TenantContext, collectionId: string): Promise<KnowledgeSourceRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.knowledgeSource).where(and(eq(schema.knowledgeSource.tenantId, ctx.tenantId), eq(schema.knowledgeSource.collectionId, collectionId))),
  ) as Promise<KnowledgeSourceRow[]>;
}

export async function getSource(ctx: TenantContext, id: string): Promise<KnowledgeSourceRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.knowledgeSource).where(and(eq(schema.knowledgeSource.id, id), eq(schema.knowledgeSource.tenantId, ctx.tenantId)));
    return (rows[0] as KnowledgeSourceRow | undefined) ?? null;
  });
}

export async function getSourceOrThrow(ctx: TenantContext, id: string): Promise<KnowledgeSourceRow> {
  const row = await getSource(ctx, id);
  if (!row) throw new KnowledgeSourceNotFoundError(id);
  return row;
}

/** Target Architecture Blueprint Phase 9 (BL-40) — the retrieval strategies resolve a
 *  page of chunks' `sourceId`s to human-readable `sourceName`s in one round trip
 *  instead of one query per chunk, the same N+1-avoidance shape `listChunksByIds`/
 *  `listEntitiesByIds` already establish elsewhere in this module. */
export async function listSourcesByIds(ctx: TenantContext, ids: string[]): Promise<KnowledgeSourceRow[]> {
  if (ids.length === 0) return [];
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.knowledgeSource).where(and(eq(schema.knowledgeSource.tenantId, ctx.tenantId), inArray(schema.knowledgeSource.id, ids))),
  ) as Promise<KnowledgeSourceRow[]>;
}

export async function setSourceStatus(
  ctx: TenantContext,
  id: string,
  status: KnowledgeSourceRow["status"],
  fields?: { documentCount?: number; failedDocumentCount?: number; failures?: KnowledgeSourceFailure[]; lastSyncedAt?: Date },
): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db
      .update(schema.knowledgeSource)
      .set({ status, ...fields, updatedAt: new Date() })
      .where(and(eq(schema.knowledgeSource.id, id), eq(schema.knowledgeSource.tenantId, ctx.tenantId))),
  );
}

/** Sources with a configured `sync_interval_seconds` whose last sync is either
 *  absent or past due — the `knowledge.source-sync` sweep's own candidate list
 *  (LLD §14.4.3's `knowledge-source-sync.ts`). Filters by interval in application
 *  code (small per-tenant source counts, no pagination need this phase) rather than
 *  a correlated-interval SQL predicate, for the same simplicity trade-off this
 *  module's other filters make. */
export async function listSourcesDueForSync(ctx: TenantContext): Promise<KnowledgeSourceRow[]> {
  const rows = (await withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.knowledgeSource).where(and(eq(schema.knowledgeSource.tenantId, ctx.tenantId), isNotNull(schema.knowledgeSource.syncIntervalSeconds))),
  )) as KnowledgeSourceRow[];
  const now = Date.now();
  return rows.filter((r) => !r.lastSyncedAt || now - r.lastSyncedAt.getTime() >= (r.syncIntervalSeconds ?? 0) * 1000);
}

export async function deleteSource(ctx: TenantContext, id: string): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.knowledgeSource).set({ purgedAt: new Date(), status: "Purged", updatedAt: new Date() }).where(and(eq(schema.knowledgeSource.id, id), eq(schema.knowledgeSource.tenantId, ctx.tenantId))),
  );
}
