import { and, eq, inArray } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { ChunkProvenance, ParsedBlock, PiiMaskEntry } from "@nextbot/db";
import { KnowledgeChunkNotFoundError } from "@nextbot/contracts";

export type KnowledgeDocumentRow = typeof schema.knowledgeDocument.$inferSelect;
export type KnowledgeChunkRow = typeof schema.knowledgeChunk.$inferSelect;

export interface UpsertDocumentInput {
  sourceId: string;
  externalRef: string;
  title: string | null;
  mimeType: string;
  contentHash: string;
}

/** Ingest stage: creates (or, if the external_ref already exists for this source,
 *  returns) the `knowledge_document` row that Parse/Chunk operate on next. Content-
 *  hash comparison (skip Parse/Chunk when unchanged on re-sync) is the caller's
 *  responsibility — this repository only persists/reads. */
export async function upsertDocumentPendingParse(ctx: TenantContext, input: UpsertDocumentInput): Promise<KnowledgeDocumentRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const existing = await db
      .select()
      .from(schema.knowledgeDocument)
      .where(and(eq(schema.knowledgeDocument.tenantId, ctx.tenantId), eq(schema.knowledgeDocument.sourceId, input.sourceId), eq(schema.knowledgeDocument.externalRef, input.externalRef)));
    if (existing[0]) {
      const row = existing[0] as KnowledgeDocumentRow;
      if (row.contentHash === input.contentHash) return row; // unchanged — caller skips Parse/Chunk
      await db
        .update(schema.knowledgeDocument)
        .set({ contentHash: input.contentHash, title: input.title, mimeType: input.mimeType, parseStatus: "Pending", ingestedAt: new Date() })
        .where(eq(schema.knowledgeDocument.id, row.id));
      const [updated] = await db.select().from(schema.knowledgeDocument).where(eq(schema.knowledgeDocument.id, row.id));
      return updated as KnowledgeDocumentRow;
    }

    const id = generateId();
    await db.insert(schema.knowledgeDocument).values({
      id,
      tenantId: ctx.tenantId,
      sourceId: input.sourceId,
      externalRef: input.externalRef,
      title: input.title,
      mimeType: input.mimeType,
      contentHash: input.contentHash,
      parseStatus: "Pending",
    });
    const [row] = await db.select().from(schema.knowledgeDocument).where(eq(schema.knowledgeDocument.id, id));
    if (!row) throw new Error("upsertDocumentPendingParse: insert did not return a row");
    return row as KnowledgeDocumentRow;
  });
}

export async function setDocumentParsed(ctx: TenantContext, id: string, parsedBlocks: ParsedBlock[], pageCount?: number): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.knowledgeDocument).set({ parsedBlocks, pageCount, parseStatus: "Synced" }).where(and(eq(schema.knowledgeDocument.id, id), eq(schema.knowledgeDocument.tenantId, ctx.tenantId))),
  );
}

export async function setDocumentParseFailed(ctx: TenantContext, id: string, code: string, message: string): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db
      .update(schema.knowledgeDocument)
      .set({ parseStatus: "Failed", parseFailure: { code, message } })
      .where(and(eq(schema.knowledgeDocument.id, id), eq(schema.knowledgeDocument.tenantId, ctx.tenantId))),
  );
}

export async function getDocument(ctx: TenantContext, id: string): Promise<KnowledgeDocumentRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.knowledgeDocument).where(and(eq(schema.knowledgeDocument.id, id), eq(schema.knowledgeDocument.tenantId, ctx.tenantId)));
    return (rows[0] as KnowledgeDocumentRow | undefined) ?? null;
  });
}

export interface InsertChunkInput {
  generationId: string;
  sourceId: string;
  documentId: string;
  ordinal: number;
  text: string;
  tokenCount: number;
  provenance: ChunkProvenance;
  aclTags: string[];
  piiMaskJson?: PiiMaskEntry[];
  /** Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — the object-store key
   *  a read-time re-evaluation can use to REDUCE masking for a higher-trust caller
   *  than the collection's own index-time trust level. Written only when the Chunk
   *  stage actually detected PII in this chunk AND the collection's trust level
   *  permits retaining the original (never for an `Untrusted` collection — see
   *  `stage-ingest-parse-chunk.ts`'s own doc comment on this decision). */
  textUnmaskedRef?: string;
  embeddingBucket: number;
}

export async function insertChunks(ctx: TenantContext, chunks: InsertChunkInput[]): Promise<KnowledgeChunkRow[]> {
  if (chunks.length === 0) return [];
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = chunks.map((c) => ({
      id: generateId(),
      tenantId: ctx.tenantId,
      generationId: c.generationId,
      sourceId: c.sourceId,
      documentId: c.documentId,
      ordinal: c.ordinal,
      text: c.text,
      tokenCount: c.tokenCount,
      provenance: c.provenance,
      aclTags: c.aclTags,
      piiMaskJson: c.piiMaskJson ?? [],
      textUnmaskedRef: c.textUnmaskedRef,
      embeddingBucket: c.embeddingBucket,
    }));
    await db.insert(schema.knowledgeChunk).values(rows);
    return db.select().from(schema.knowledgeChunk).where(and(eq(schema.knowledgeChunk.tenantId, ctx.tenantId), eq(schema.knowledgeChunk.generationId, chunks[0]!.generationId), eq(schema.knowledgeChunk.documentId, chunks[0]!.documentId))) as Promise<KnowledgeChunkRow[]>;
  });
}

export async function listChunksForGeneration(ctx: TenantContext, generationId: string): Promise<KnowledgeChunkRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.knowledgeChunk).where(and(eq(schema.knowledgeChunk.tenantId, ctx.tenantId), eq(schema.knowledgeChunk.generationId, generationId))),
  ) as Promise<KnowledgeChunkRow[]>;
}

/**
 * FR-KB-04's own critical requirement: a curator following a relation's provenance
 * link must see the ACTUAL SOURCE CHUNK TEXT, never merely an id. This is the one
 * read path the Graph Explorer (Phase 8) uses to resolve `graph_edge.provenance_
 * chunk_id` into something a human can read. `text` here is already index-time
 * masked per the chunk's collection `trust_level` (§14.4.2) — this function never
 * reads `text_unmasked_ref` (that column is read only inside `pii/application/
 * masker.ts`, per that column's own doc comment).
 */
export async function getChunkById(ctx: TenantContext, id: string): Promise<KnowledgeChunkRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.knowledgeChunk).where(and(eq(schema.knowledgeChunk.id, id), eq(schema.knowledgeChunk.tenantId, ctx.tenantId)));
    return (rows[0] as KnowledgeChunkRow | undefined) ?? null;
  });
}

export async function getChunkOrThrow(ctx: TenantContext, id: string): Promise<KnowledgeChunkRow> {
  const row = await getChunkById(ctx, id);
  if (!row) throw new KnowledgeChunkNotFoundError(id);
  return row;
}

/** Batch provenance lookup — the Graph Explorer's entity-detail view (Phase 8)
 *  resolves every one of an entity's relations' `provenance_chunk_id`s in one round
 *  trip instead of one query per edge. */
export async function listChunksByIds(ctx: TenantContext, ids: string[]): Promise<KnowledgeChunkRow[]> {
  if (ids.length === 0) return [];
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.knowledgeChunk).where(and(eq(schema.knowledgeChunk.tenantId, ctx.tenantId), inArray(schema.knowledgeChunk.id, ids))),
  ) as Promise<KnowledgeChunkRow[]>;
}

export async function listChunksForDocument(ctx: TenantContext, generationId: string, documentId: string): Promise<KnowledgeChunkRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.knowledgeChunk)
      .where(and(eq(schema.knowledgeChunk.tenantId, ctx.tenantId), eq(schema.knowledgeChunk.generationId, generationId), eq(schema.knowledgeChunk.documentId, documentId))),
  ) as Promise<KnowledgeChunkRow[]>;
}

/** Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08/FR-ADM-06) — every chunk a
 *  source has ever produced, across EVERY generation (a source's chunks are NOT
 *  scoped to just the collection's current generation — an older, superseded
 *  generation still references them until it is itself purged/rebuilt). Purging a
 *  source must forget its content everywhere, not merely from the live index. */
export async function listChunksForSource(ctx: TenantContext, sourceId: string): Promise<KnowledgeChunkRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.knowledgeChunk).where(and(eq(schema.knowledgeChunk.tenantId, ctx.tenantId), eq(schema.knowledgeChunk.sourceId, sourceId))),
  ) as Promise<KnowledgeChunkRow[]>;
}

/** Target Architecture Blueprint Phase 11 (BL-42, FR-ADM-06) — the retention-purge
 *  cascade's own chunk-removal step. Never called for any other reason — a chunk is
 *  otherwise immutable/append-only for the lifetime of its generation. */
export async function deleteChunksByIds(ctx: TenantContext, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await withTenant(ctx, (db: TenantScopedClient) => db.delete(schema.knowledgeChunk).where(and(eq(schema.knowledgeChunk.tenantId, ctx.tenantId), inArray(schema.knowledgeChunk.id, ids))));
}
