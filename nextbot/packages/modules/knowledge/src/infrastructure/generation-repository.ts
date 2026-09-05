import { and, desc, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { IngestionStageProgress } from "@nextbot/db";
import { KnowledgeGenerationNotReadyError } from "@nextbot/contracts";

export type KnowledgeGenerationRow = typeof schema.knowledgeIndexGeneration.$inferSelect;

export interface CreateGenerationInput {
  collectionId: string;
  embeddingProviderId: string;
  embeddingCatalogEntryId: string;
  dimension: number;
  extractionCatalogEntryId: string;
  graphGenerationLabel: string;
  supersedesGenerationId?: string | null;
}

/** The next monotonic `generation` ordinal for a collection — read-then-insert
 *  inside the same `withTenant` call, which is acceptable here (unlike a
 *  high-concurrency counter) because generation creation is an infrequent,
 *  explicitly admin-triggered action, not a hot path multiple callers race on
 *  simultaneously in practice; the `UNIQUE (tenant_id, collection_id, generation)`
 *  constraint is the real backstop if that assumption is ever wrong. */
export async function createGeneration(ctx: TenantContext, input: CreateGenerationInput): Promise<KnowledgeGenerationRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const existing = await db
      .select({ generation: schema.knowledgeIndexGeneration.generation })
      .from(schema.knowledgeIndexGeneration)
      .where(and(eq(schema.knowledgeIndexGeneration.tenantId, ctx.tenantId), eq(schema.knowledgeIndexGeneration.collectionId, input.collectionId)))
      .orderBy(desc(schema.knowledgeIndexGeneration.generation))
      .limit(1);
    const nextGeneration = (existing[0]?.generation ?? 0) + 1;

    const id = generateId();
    await db.insert(schema.knowledgeIndexGeneration).values({
      id,
      tenantId: ctx.tenantId,
      collectionId: input.collectionId,
      generation: nextGeneration,
      embeddingProviderId: input.embeddingProviderId,
      embeddingCatalogEntryId: input.embeddingCatalogEntryId,
      dimension: input.dimension,
      extractionCatalogEntryId: input.extractionCatalogEntryId,
      graphGenerationLabel: input.graphGenerationLabel,
      supersedesGenerationId: input.supersedesGenerationId,
    });
    const [row] = await db.select().from(schema.knowledgeIndexGeneration).where(eq(schema.knowledgeIndexGeneration.id, id));
    if (!row) throw new Error("createGeneration: insert did not return a row");
    return row as KnowledgeGenerationRow;
  });
}

export async function getGeneration(ctx: TenantContext, id: string): Promise<KnowledgeGenerationRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.knowledgeIndexGeneration).where(and(eq(schema.knowledgeIndexGeneration.id, id), eq(schema.knowledgeIndexGeneration.tenantId, ctx.tenantId)));
    return (rows[0] as KnowledgeGenerationRow | undefined) ?? null;
  });
}

export async function getGenerationOrThrow(ctx: TenantContext, id: string): Promise<KnowledgeGenerationRow> {
  const row = await getGeneration(ctx, id);
  if (!row) throw new KnowledgeGenerationNotReadyError(id);
  return row;
}

export async function listGenerationsForCollection(ctx: TenantContext, collectionId: string): Promise<KnowledgeGenerationRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.knowledgeIndexGeneration)
      .where(and(eq(schema.knowledgeIndexGeneration.tenantId, ctx.tenantId), eq(schema.knowledgeIndexGeneration.collectionId, collectionId)))
      .orderBy(desc(schema.knowledgeIndexGeneration.generation)),
  ) as Promise<KnowledgeGenerationRow[]>;
}

export async function getCurrentReadyGenerationForCollection(ctx: TenantContext, collectionId: string): Promise<KnowledgeGenerationRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.knowledgeIndexGeneration)
      .where(
        and(
          eq(schema.knowledgeIndexGeneration.tenantId, ctx.tenantId),
          eq(schema.knowledgeIndexGeneration.collectionId, collectionId),
          eq(schema.knowledgeIndexGeneration.status, "Ready"),
        ),
      )
      .orderBy(desc(schema.knowledgeIndexGeneration.generation))
      .limit(1);
    return (rows[0] as KnowledgeGenerationRow | undefined) ?? null;
  });
}

export async function updateGenerationStageProgress(ctx: TenantContext, id: string, stageProgress: IngestionStageProgress): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.knowledgeIndexGeneration).set({ stageProgress }).where(and(eq(schema.knowledgeIndexGeneration.id, id), eq(schema.knowledgeIndexGeneration.tenantId, ctx.tenantId))),
  );
}

export async function updateGenerationCounts(
  ctx: TenantContext,
  id: string,
  counts: Partial<{ chunkCount: number; entityCount: number; edgeCount: number; communityCount: number; buildCostUsd: string }>,
): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.knowledgeIndexGeneration).set(counts).where(and(eq(schema.knowledgeIndexGeneration.id, id), eq(schema.knowledgeIndexGeneration.tenantId, ctx.tenantId))),
  );
}

export async function markGenerationReady(ctx: TenantContext, id: string): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.knowledgeIndexGeneration).set({ status: "Ready", builtAt: new Date() }).where(and(eq(schema.knowledgeIndexGeneration.id, id), eq(schema.knowledgeIndexGeneration.tenantId, ctx.tenantId))),
  );
}

/**
 * Stage 10 — Index (LLD §14.4.3: "flips generation.status='Ready' and
 * collection.current_generation_id in one transaction; only here"). Both updates
 * run inside the SAME `withTenant` call (one BEGIN/COMMIT boundary — `withTenant`
 * wraps its whole callback in one transaction, the same fact Phase 5's
 * `createAgentDefinitionVersion` relied on for its own same-transaction
 * composition), so retrieval never observes a generation marked Ready without the
 * collection already pointing at it, or vice versa.
 */
export async function markGenerationReadyAndSetCurrent(ctx: TenantContext, generationId: string, collectionId: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    const [generation] = await db.select({ supersedesGenerationId: schema.knowledgeIndexGeneration.supersedesGenerationId }).from(schema.knowledgeIndexGeneration).where(eq(schema.knowledgeIndexGeneration.id, generationId));
    await db.update(schema.knowledgeIndexGeneration).set({ status: "Ready", builtAt: new Date() }).where(and(eq(schema.knowledgeIndexGeneration.id, generationId), eq(schema.knowledgeIndexGeneration.tenantId, ctx.tenantId)));
    // FR-KB-03 — an old generation stays queryable but frozen until the new one
    // takes over, then transitions to Superseded (retained for retention_days,
    // then hard-deleted — a later phase's DSR/retention cascade job's concern, not
    // this one's).
    if (generation?.supersedesGenerationId) {
      await db.update(schema.knowledgeIndexGeneration).set({ status: "Superseded" }).where(and(eq(schema.knowledgeIndexGeneration.id, generation.supersedesGenerationId), eq(schema.knowledgeIndexGeneration.tenantId, ctx.tenantId)));
    }
    await db
      .update(schema.knowledgeCollection)
      .set({ currentGenerationId: generationId, status: "Ready", updatedAt: new Date() })
      .where(and(eq(schema.knowledgeCollection.id, collectionId), eq(schema.knowledgeCollection.tenantId, ctx.tenantId)));
  });
}

export async function markGenerationFailed(ctx: TenantContext, id: string, reason: string): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.knowledgeIndexGeneration).set({ status: "Failed", failureReason: reason }).where(and(eq(schema.knowledgeIndexGeneration.id, id), eq(schema.knowledgeIndexGeneration.tenantId, ctx.tenantId))),
  );
}

export async function markGenerationCancelled(ctx: TenantContext, id: string): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.knowledgeIndexGeneration).set({ status: "Cancelled", failureReason: "Cancelled by admin." }).where(and(eq(schema.knowledgeIndexGeneration.id, id), eq(schema.knowledgeIndexGeneration.tenantId, ctx.tenantId))),
  );
}
