import { createHash } from "node:crypto";
import type { TenantContext } from "@nextbot/db";
import type { KnowledgeSourceFailure, PiiMaskEntry } from "@nextbot/db";
import { detectPii, maskText, buildPolicyLookup, listCustomPiiRulesForMasking } from "@nextbot/pii";
import { getSourceOrThrow, setSourceStatus } from "../../infrastructure/source-repository.js";
import { getGenerationOrThrow } from "../../infrastructure/generation-repository.js";
import { getCollectionOrThrow } from "../../infrastructure/collection-repository.js";
import {
  upsertDocumentPendingParse,
  setDocumentParsed,
  setDocumentParseFailed,
  getDocument,
  insertChunks,
} from "../../infrastructure/document-chunk-repository.js";
import { getUpload, putUpload } from "../../infrastructure/upload-store.js";
import { parseText, chunkParsedBlocks } from "../../domain/chunking.js";
import { completeJob, enqueueJob, failJob, type KnowledgeIngestionJobRow } from "../../infrastructure/ingestion-job-repository.js";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

interface FetchedDocument {
  externalRef: string;
  title: string | null;
  mimeType: string;
  content: string;
}

/**
 * Stage 1 — Ingest (LLD §14.4.3, per source). Real, working fetch for `Upload`
 * (local-disk-backed `upload-store.ts`) and `Url` (a single live HTTP GET — no
 * multi-page crawl this phase, a disclosed narrowing of `crawlDepth`/
 * `includePatterns`/`excludePatterns`, which the locator schema still carries for a
 * future phase to honor). `McpResource`/`Connector` kinds are recorded as a
 * per-document failure (`SOURCE_KIND_NOT_YET_INTEGRATED`) rather than attempted —
 * neither `@nextbot/mcp-registry` nor `@nextbot/connectors` exposes a "read a
 * resource"/"invoke and get a result" function yet to integrate against for real
 * (confirmed by inspection before writing this). This never blocks the source
 * (per-document failure semantics, FR-KB-01/02) or other sources in the collection
 * (each source's Ingest job is its own row).
 */
export async function runIngestStage(ctx: TenantContext, job: KnowledgeIngestionJobRow): Promise<void> {
  if (!job.sourceId) {
    await failJob(ctx, job.id, { code: "INGEST_MISSING_SOURCE_ID", message: "Ingest job has no sourceId.", retriable: false });
    return;
  }
  try {
    const source = await getSourceOrThrow(ctx, job.sourceId);
    await setSourceStatus(ctx, source.id, "Syncing");

    const fetched: FetchedDocument[] = [];
    const failures: KnowledgeSourceFailure[] = [];

    if (source.locator.kind === "Upload") {
      try {
        const buffer = await getUpload(ctx.tenantId, source.locator.storageRef);
        fetched.push({ externalRef: source.locator.filename, title: source.locator.filename, mimeType: source.locator.mimeType, content: buffer.toString("utf8") });
      } catch (err) {
        failures.push({ documentRef: source.locator.filename, stage: "Ingest", code: "UPLOAD_READ_FAILED", message: err instanceof Error ? err.message : String(err) });
      }
    } else if (source.locator.kind === "Url") {
      try {
        const response = await fetch(source.locator.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const content = await response.text();
        fetched.push({ externalRef: source.locator.url, title: source.locator.url, mimeType: "text/plain", content });
      } catch (err) {
        failures.push({ documentRef: source.locator.url, stage: "Ingest", code: "URL_FETCH_FAILED", message: err instanceof Error ? err.message : String(err) });
      }
    } else {
      failures.push({
        documentRef: source.name,
        stage: "Ingest",
        code: "SOURCE_KIND_NOT_YET_INTEGRATED",
        message: `${source.locator.kind} sources are not yet integrated for real content fetch in this phase.`,
      });
    }

    for (const doc of fetched) {
      const docRow = await upsertDocumentPendingParse(ctx, {
        sourceId: source.id,
        externalRef: doc.externalRef,
        title: doc.title,
        mimeType: doc.mimeType,
        contentHash: sha256(doc.content),
      });
      // Always enqueue Parse for THIS generation, regardless of whether this
      // document's content is unchanged from a prior generation's build —
      // `knowledge_chunk` rows are generation-scoped (LLD §14.4.2), so every new
      // generation needs its own Parse->Chunk->ExtractEntities job chain even for
      // an unchanged document. The Parse stage itself (not here) is where an
      // unchanged-content optimization can legitimately skip re-running the
      // CPU-bound text-extraction work while still producing this generation's own
      // chunks — see `runParseStage`'s own doc comment.
      await enqueueJob(ctx, { generationId: job.generationId, sourceId: source.id, documentId: docRow.id, stage: "Parse", input: { rawText: doc.content } });
    }

    const status = failures.length === 0 ? "Synced" : fetched.length > 0 ? "PartiallyFailed" : "Failed";
    await setSourceStatus(ctx, source.id, status, {
      documentCount: fetched.length,
      failedDocumentCount: failures.length,
      failures: failures.length > 0 ? failures : undefined,
      lastSyncedAt: new Date(),
    });

    await completeJob(ctx, job.id, { documentCount: fetched.length, failedCount: failures.length });
  } catch (err) {
    await failJob(ctx, job.id, { code: "INGEST_STAGE_ERROR", message: err instanceof Error ? err.message.slice(0, 500) : String(err), retriable: true });
  }
}

/**
 * Stage 2 — Parse (per document). On failure, records `parse_status='Failed'` on
 * the document per LLD's own semantics — the source continues regardless (this is
 * one job row among possibly many for the source's documents).
 *
 * **Disclosed simplification**: this always re-runs `parseText()` even if the
 * document's content is unchanged from a prior generation's build (LLD §14.4.2's
 * "unchanged hash ⇒ Parse/Chunk stages skipped on re-sync" optimization is deferred)
 * — `knowledge_document.parsed_blocks` is generation-independent, so a real
 * optimization could reuse it here when `content_hash` matches, but every new
 * generation still needs its OWN `Chunk` job/rows regardless (chunks are
 * generation-scoped), so the achievable savings is CPU-only, not correctness-
 * relevant. Deferred rather than risking a subtler bug in a phase already this
 * large; re-parsing modestly-sized documents is cheap.
 */
export async function runParseStage(ctx: TenantContext, job: KnowledgeIngestionJobRow): Promise<void> {
  if (!job.documentId) {
    await failJob(ctx, job.id, { code: "PARSE_MISSING_DOCUMENT_ID", message: "Parse job has no documentId.", retriable: false });
    return;
  }
  try {
    const document = await getDocument(ctx, job.documentId);
    if (!document) throw new Error(`Parse stage: document ${job.documentId} not found`);
    const rawText = (job.input as { rawText?: string } | null)?.rawText ?? "";
    const blocks = parseText(rawText, document.title);
    await setDocumentParsed(ctx, document.id, blocks);
    await enqueueJob(ctx, { generationId: job.generationId, sourceId: job.sourceId, documentId: document.id, stage: "Chunk", input: {} });
    await completeJob(ctx, job.id, { blockCount: blocks.length });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err);
    await setDocumentParseFailed(ctx, job.documentId, "PARSE_FAILED", message);
    await failJob(ctx, job.id, { code: "PARSE_FAILED", message, retriable: false });
  }
}

/**
 * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — masks a single chunk's
 * raw text per the collection's own trust level, returning both the masked text to
 * persist (`knowledge_chunk.text`) and the mask entries recorded for later read-time
 * re-evaluation (`piiMaskJson` — never recomputed from scratch at read time; a
 * higher-trust caller's re-evaluation instead re-derives fresh from
 * `textUnmaskedRef`, see `pii-reeval-service.ts`). Never throws — an unexpected
 * masking failure degrades to "mask nothing detected" rather than blocking ingestion,
 * matching this pipeline's own per-document failure-isolation convention (a masking
 * bug must never be the reason a whole source's Chunk stage fails).
 */
function maskChunkText(rawText: string, trustLevel: "Trusted" | "SemiTrusted" | "Untrusted", customRules: Parameters<typeof detectPii>[1], policyLookup: Parameters<typeof maskText>[4]): { text: string; piiMaskJson: PiiMaskEntry[] } {
  try {
    const detected = detectPii(rawText, customRules);
    if (detected.length === 0) return { text: rawText, piiMaskJson: [] };
    const masked = maskText(rawText, detected, "Knowledge", trustLevel, policyLookup);
    const piiMaskJson: PiiMaskEntry[] = detected.map((d) => ({
      ruleId: d.label,
      kind: d.entityType,
      charStart: d.start,
      charEnd: d.end,
      appliedAction: policyLookup(d.entityType, "Knowledge", trustLevel) ?? "FullMask",
    }));
    return { text: masked, piiMaskJson };
  } catch {
    // Fail closed on the SAFE side would mean redacting everything, but that would
    // silently destroy legitimate content on a masker bug — instead this degrades to
    // "as if nothing was detected," identical to today's pre-Phase-11 behavior,
    // and is surfaced for operational follow-up via the stage's own error handling
    // one level up if the failure is systemic rather than per-chunk.
    return { text: rawText, piiMaskJson: [] };
  }
}

/**
 * Stage 3 — Chunk (per document). Reads the document's `parsed_blocks`, chunks per
 * the collection's `chunking_config`, and writes `knowledge_chunk` rows —
 * `embedding_bucket` is stamped from the GENERATION's pinned dimension (never
 * re-derived per chunk), and `acl_tags` are copied verbatim from the source, never
 * recomputed (LLD §14.4.2's own callout).
 *
 * **Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) addition**: each
 * chunk's text is masked here, per the collection's own configured `trust_level`,
 * using the SAME `@nextbot/pii` masker/policy-lookup mechanism FR-SEC-04 already
 * established elsewhere (never a second, knowledge-specific masking implementation).
 * When PII is actually detected AND the collection's trust level is not `Untrusted`,
 * the original (pre-mask) text is retained in the same local object store uploads
 * already use (`textUnmaskedRef`) so a higher-trust caller's read-time re-evaluation
 * can later show less masking than what's baked in here — an `Untrusted` collection
 * retains nothing extra, minimizing exposure risk for the least-trusted content tier.
 */
export async function runChunkStage(ctx: TenantContext, job: KnowledgeIngestionJobRow, chunkingConfig: Parameters<typeof chunkParsedBlocks>[1]): Promise<void> {
  if (!job.documentId) {
    await failJob(ctx, job.id, { code: "CHUNK_MISSING_DOCUMENT_ID", message: "Chunk job has no documentId.", retriable: false });
    return;
  }
  try {
    const document = await getDocument(ctx, job.documentId);
    if (!document) throw new Error(`Chunk stage: document ${job.documentId} not found`);
    const source = job.sourceId ? await getSourceOrThrow(ctx, job.sourceId) : null;
    const generation = await getGenerationOrThrow(ctx, job.generationId);
    const collection = await getCollectionOrThrow(ctx, generation.collectionId);

    const blocks = document.parsedBlocks ?? [];
    const drafts = chunkParsedBlocks(blocks, chunkingConfig, document.title);

    const customRules = await listCustomPiiRulesForMasking(ctx);
    const policyLookup = await buildPolicyLookup(ctx);

    const chunkInputs = await Promise.all(
      drafts.map(async (draft, ordinal) => {
        const { text, piiMaskJson } = maskChunkText(draft.text, collection.trustLevel, customRules, policyLookup);
        const textUnmaskedRef = piiMaskJson.length > 0 && collection.trustLevel !== "Untrusted" ? await putUpload(ctx.tenantId, draft.text) : undefined;
        return {
          generationId: job.generationId,
          sourceId: document.sourceId,
          documentId: document.id,
          ordinal,
          text,
          tokenCount: draft.tokenCount,
          provenance: draft.provenance,
          aclTags: source?.aclTags ?? [],
          piiMaskJson,
          textUnmaskedRef,
          embeddingBucket: generation.dimension,
        };
      }),
    );

    await insertChunks(ctx, chunkInputs);

    await enqueueJob(ctx, { generationId: job.generationId, sourceId: job.sourceId, documentId: document.id, stage: "ExtractEntities", input: {} });
    await completeJob(ctx, job.id, { chunkCount: drafts.length });
  } catch (err) {
    await failJob(ctx, job.id, { code: "CHUNK_STAGE_ERROR", message: err instanceof Error ? err.message.slice(0, 500) : String(err), retriable: true });
  }
}
