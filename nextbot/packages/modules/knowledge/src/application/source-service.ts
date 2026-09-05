import type { TenantContext } from "@nextbot/db";
import type { KnowledgeAcl, KnowledgeSourceLocator } from "@nextbot/db";
import { KnowledgeSourceLocatorInvalidError } from "@nextbot/contracts";
import { createSource as createSourceRow, listSourcesForCollection, getSourceOrThrow, type KnowledgeSourceRow } from "../infrastructure/source-repository.js";
import { getCollectionOrThrow } from "../infrastructure/collection-repository.js";
import { getCurrentReadyGenerationForCollection } from "../infrastructure/generation-repository.js";
import { enqueueJob } from "../infrastructure/ingestion-job-repository.js";
import { deriveAclTags } from "../domain/acl.js";
import { putUpload } from "../infrastructure/upload-store.js";
import { purgeSourceContent } from "./retention-service.js";

/** Validates a locator's shape matches its declared `kind` before it is ever
 *  persisted — FR-KB-02/§14.4.5's `KNOWLEDGE_SOURCE_LOCATOR_INVALID` (422). */
function assertLocatorValid(kind: KnowledgeSourceLocator["kind"], locator: KnowledgeSourceLocator): void {
  if (locator.kind !== kind) throw new KnowledgeSourceLocatorInvalidError(`locator.kind ('${locator.kind}') must match the source's own kind ('${kind}').`);
  if (locator.kind === "Upload" && (!locator.storageRef || !locator.filename)) throw new KnowledgeSourceLocatorInvalidError("An Upload locator requires storageRef and filename.");
  if (locator.kind === "Url" && !locator.url) throw new KnowledgeSourceLocatorInvalidError("A Url locator requires url.");
  if (locator.kind === "McpResource" && (!locator.mcpManifestItemId || !locator.uri)) throw new KnowledgeSourceLocatorInvalidError("An McpResource locator requires mcpManifestItemId and uri.");
  if (locator.kind === "Connector" && (!locator.connectorId || !locator.toolName)) throw new KnowledgeSourceLocatorInvalidError("A Connector locator requires connectorId and toolName.");
}

export interface CreateSourceRequest {
  collectionId: string;
  kind: KnowledgeSourceLocator["kind"];
  name: string;
  locator: KnowledgeSourceLocator;
  acl: KnowledgeAcl;
  syncIntervalSeconds?: number | null;
}

/** Captures ACLs at ingestion (FR-KB-02) — `acl_tags` is derived here, once, and
 *  never recomputed by any downstream stage (see `domain/acl.ts`). */
export async function createSource(ctx: TenantContext, req: CreateSourceRequest): Promise<KnowledgeSourceRow> {
  await getCollectionOrThrow(ctx, req.collectionId); // 404s if the collection doesn't exist/isn't this tenant's
  assertLocatorValid(req.kind, req.locator);
  const aclTags = deriveAclTags(ctx.tenantId, req.acl);
  return createSourceRow(ctx, { collectionId: req.collectionId, kind: req.kind, name: req.name, locator: req.locator, acl: req.acl, aclTags, syncIntervalSeconds: req.syncIntervalSeconds });
}

/** Stores raw uploaded bytes and returns a ready-to-use `Upload` locator — the
 *  console's "add a file" flow calls this before calling `createSource`. */
export async function storeUploadAndBuildLocator(ctx: TenantContext, filename: string, mimeType: string, content: Buffer | string): Promise<KnowledgeSourceLocator> {
  const storageRef = await putUpload(ctx.tenantId, content);
  const sizeBytes = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content, "utf8");
  return { kind: "Upload", storageRef, filename, mimeType, sizeBytes };
}

export { listSourcesForCollection, getSourceOrThrow };

/**
 * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08/FR-ADM-06) — deleting a
 * source now cascades for real: its chunks (across every generation), any entity/
 * edge with no other provenance, and affected communities' re-summarization all go
 * through `purgeSourceContent` — the SAME code path the retention sweep uses, so an
 * explicit admin delete and an automatic retention-driven purge are never two
 * different behaviors. Previously this only flipped `knowledge_source.status` to
 * `'Purged'` without removing any downstream content — a real, disclosed gap this
 * phase closes (see `retention-service.ts`'s own doc comment for what "no other
 * provenance" checks and why community re-summarization is reused rather than
 * reimplemented).
 */
export async function deleteSource(ctx: TenantContext, sourceId: string): Promise<void> {
  await purgeSourceContent(ctx, sourceId);
}

/** Manually triggers a re-sync (`POST .../sources/{id}/sync`) — enqueues a fresh
 *  Ingest job into the collection's CURRENT Ready generation. A collection with no
 *  Ready generation yet has nothing to sync into (the source will be picked up by
 *  the next full generation build instead). */
export async function triggerSourceSync(ctx: TenantContext, sourceId: string): Promise<{ enqueued: boolean }> {
  const source = await getSourceOrThrow(ctx, sourceId);
  const generation = await getCurrentReadyGenerationForCollection(ctx, source.collectionId);
  if (!generation) return { enqueued: false };
  const job = await enqueueJob(ctx, { generationId: generation.id, sourceId: source.id, stage: "Ingest", input: {} });
  return { enqueued: job !== null };
}
