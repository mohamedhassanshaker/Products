/**
 * The real `ChunkRepository` — `SourceDocuments`/`Chunks`, plus the one place the §9.2
 * write-ordering invariant is actually enforced: `createDocumentWithChunks` writes the
 * document, its chunks (`Pending`/`Pending`) and one `OutboxEvent` per chunk inside a
 * single `$transaction`.
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import { isDerivedIndexState } from "../../../domain/knowledge-catalog.js";
import type {
  ApplyEmbedResultInput,
  ChunkRepository,
  ChunkRow,
  NewChunkInput,
  NewSourceDocumentInput,
  SourceDocumentRow,
} from "../../../ports/chunk-repository.js";

const OPERATION = "knowledge chunk repository";

function toChunkRow(row: {
  id: string;
  sourceDocumentId: string;
  knowledgeSourceId: string;
  knowledgeCollectionId: string;
  ordinal: number;
  text: string;
  charStart: number;
  charEnd: number;
  sectionPath: string | null;
  pageNumber: number | null;
  localeCode: string;
  embeddingModel: string | null;
  embeddingDimension: number | null;
  vectorState: string;
  graphState: string;
  erasedAt: Date | null;
}): ChunkRow {
  if (!isDerivedIndexState(row.vectorState) || !isDerivedIndexState(row.graphState)) {
    throw new Error(`Chunk ${row.id} has an unrecognized vectorState/graphState.`);
  }
  return {
    id: row.id,
    sourceDocumentId: row.sourceDocumentId,
    knowledgeSourceId: row.knowledgeSourceId,
    knowledgeCollectionId: row.knowledgeCollectionId,
    ordinal: row.ordinal,
    text: row.text,
    charStart: row.charStart,
    charEnd: row.charEnd,
    sectionPath: row.sectionPath,
    pageNumber: row.pageNumber,
    localeCode: row.localeCode,
    embeddingModel: row.embeddingModel,
    embeddingDimension: row.embeddingDimension,
    vectorState: row.vectorState,
    graphState: row.graphState,
    erasedAt: row.erasedAt,
  };
}

/** A stable, content-derived dedupe key: the same chunk id can never enqueue two distinct `ChunkUpserted` intents. */
function chunkUpsertDedupeKey(chunkId: string): string {
  return `chunk-upsert-${chunkId}`;
}

export class PrismaChunkRepository implements ChunkRepository {
  async createDocumentWithChunks(input: {
    readonly document: NewSourceDocumentInput;
    readonly chunks: readonly Omit<NewChunkInput, "sourceDocumentId">[];
  }): Promise<{ readonly document: SourceDocumentRow; readonly chunks: readonly ChunkRow[] }> {
    const db = getTenantDb(OPERATION);
    const { document, chunks } = input;
    const documentId = newUlid(document.now);
    // Not `chunks.map((_, index) => ...)`: this project's lint config rejects any unused
    // callback parameter, even underscore-named (see slider.tsx's identical note) — a plain
    // indexed loop avoids the unused first argument entirely.
    const chunkIds: string[] = [];
    for (let index = 0; index < chunks.length; index++) {
      chunkIds.push(newUlid(new Date(document.now.getTime() + index + 1)));
    }

    await db.$transaction([
      // Supersede the prior live document for this source, if any (re-crawl).
      ...(document.supersedesDocumentId
        ? [
            db.sourceDocument.update({
              where: { id: document.supersedesDocumentId },
              data: {
                supersededAt: document.now,
                supersededByDocumentId: documentId,
                updatedAt: document.now,
              },
            }),
          ]
        : []),
      db.sourceDocument.create({
        data: {
          id: documentId,
          knowledgeSourceId: document.knowledgeSourceId,
          externalRef: document.externalRef,
          title: document.title,
          contentHash: document.contentHash,
          byteSize: document.byteSize,
          mimeType: document.mimeType,
          localeCode: document.localeCode,
          storageRef: document.storageRef,
          fetchedAt: document.fetchedAt,
          supersededByDocumentId: null,
          supersededAt: null,
          createdAt: document.now,
          updatedAt: document.now,
        },
      }),
      ...chunks.flatMap((chunk, index) => {
        const chunkId = chunkIds[index];
        if (!chunkId) {
          throw new Error(`Internal error: no id was minted for chunk at index ${index}.`);
        }
        return [
          db.chunk.create({
            data: {
              id: chunkId,
              sourceDocumentId: documentId,
              knowledgeSourceId: chunk.knowledgeSourceId,
              knowledgeCollectionId: chunk.knowledgeCollectionId,
              ordinal: chunk.ordinal,
              text: chunk.text,
              tokenCount: chunk.tokenCount,
              charStart: chunk.charStart,
              charEnd: chunk.charEnd,
              contentHash: chunk.contentHash,
              sectionPath: chunk.sectionPath,
              pageNumber: chunk.pageNumber,
              localeCode: chunk.localeCode,
              embeddingModel: null,
              embeddingDimension: null,
              embeddedAt: null,
              vectorState: "Pending",
              graphState: "Pending",
              erasedAt: null,
              createdAt: document.now,
              updatedAt: document.now,
            },
          }),
          // §9.2's invariant: the domain row and its outbox intent are the SAME
          // transaction, so there is no window where a Chunk exists with no queued intent
          // to index it.
          db.outboxEvent.create({
            data: {
              id: newUlid(new Date(document.now.getTime() + index + 1000)),
              aggregateKind: "Chunk",
              aggregateId: chunkId,
              eventType: "ChunkUpserted",
              targetStore: "Both",
              payloadJson: JSON.stringify({
                knowledgeSourceId: chunk.knowledgeSourceId,
                knowledgeCollectionId: chunk.knowledgeCollectionId,
              }),
              dedupeKey: chunkUpsertDedupeKey(chunkId),
              state: "Pending",
              attemptCount: 0,
              maxAttempts: 8,
              availableAt: document.now,
              lockedBy: null,
              lockedUntil: null,
              lastError: null,
              appliedAt: null,
              occurredAt: document.now,
              createdAt: document.now,
              updatedAt: document.now,
            },
          }),
        ];
      }),
    ]);

    const [createdDocument, createdChunks] = await Promise.all([
      db.sourceDocument.findFirstOrThrow({ where: { id: documentId } }),
      db.chunk.findMany({ where: { id: { in: chunkIds } }, orderBy: { ordinal: "asc" } }),
    ]);

    return {
      document: {
        id: createdDocument.id,
        knowledgeSourceId: createdDocument.knowledgeSourceId,
        contentHash: createdDocument.contentHash,
        supersededAt: createdDocument.supersededAt,
      },
      chunks: createdChunks.map(toChunkRow),
    };
  }

  async listChunksBySource(knowledgeSourceId: string): Promise<readonly ChunkRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.chunk.findMany({
      where: { knowledgeSourceId, erasedAt: null },
      orderBy: { ordinal: "asc" },
    });
    return rows.map(toChunkRow);
  }

  async listChunksByIds(ids: readonly string[]): Promise<readonly ChunkRow[]> {
    if (ids.length === 0) return [];
    const db = getTenantDb(OPERATION);
    const rows = await db.chunk.findMany({ where: { id: { in: [...ids] } } });
    return rows.map(toChunkRow);
  }

  async listAllChunks(): Promise<readonly ChunkRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.chunk.findMany({ where: { erasedAt: null } });
    return rows.map(toChunkRow);
  }

  async applyEmbedResult(input: ApplyEmbedResultInput): Promise<void> {
    const db = getTenantDb(OPERATION);
    const embedded: Partial<{
      embeddingModel: string;
      embeddingDimension: number;
      embeddedAt: Date;
    }> =
      input.vectorState === "Indexed"
        ? {
            embeddingModel: input.embeddingModel,
            embeddingDimension: input.embeddingDimension,
            embeddedAt: input.now,
          }
        : {};
    await db.chunk.update({
      where: { id: input.chunkId },
      data: {
        vectorState: input.vectorState,
        graphState: input.graphState,
        ...embedded,
        updatedAt: input.now,
      },
    });
  }

  async resetToPending(chunkIds: readonly string[], now: Date): Promise<void> {
    if (chunkIds.length === 0) return;
    const db = getTenantDb(OPERATION);
    await db.chunk.updateMany({
      where: { id: { in: [...chunkIds] } },
      data: { vectorState: "Pending", graphState: "Pending", updatedAt: now },
    });
  }

  async markErased(chunkIds: readonly string[], now: Date): Promise<void> {
    if (chunkIds.length === 0) return;
    const db = getTenantDb(OPERATION);
    await db.chunk.updateMany({
      where: { id: { in: [...chunkIds] } },
      data: { erasedAt: now, updatedAt: now },
    });
  }

  async countNonErasedChunksForSource(knowledgeSourceId: string): Promise<number> {
    const db = getTenantDb(OPERATION);
    return db.chunk.count({ where: { knowledgeSourceId, erasedAt: null } });
  }
}
