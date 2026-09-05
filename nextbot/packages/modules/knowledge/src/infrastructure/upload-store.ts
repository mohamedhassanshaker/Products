import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Target Architecture Blueprint Phase 7b (BL-38) — a minimal, local-disk-backed
 * object store scoped to THIS module only. **Disclosed narrowing**: no object-store
 * abstraction (S3/blob/local-disk fake) exists anywhere in this codebase yet
 * (confirmed by search before writing this) — this is sufficient for a real small
 * document upload/ingest/e2e test, which is what this phase's own exit gate
 * requires; a shared `@nextbot/object-store` package is a reasonable future
 * extraction once a second real consumer needs one (e.g. escalation attachments),
 * not manufactured here for a single caller.
 *
 * Root directory is env-configurable (`KNOWLEDGE_UPLOAD_STORE_ROOT`, default
 * `.data/knowledge-uploads` under the process cwd — matching this repo's existing
 * convention of defaulting local/dev-only state under a `.data`-shaped path) so a
 * test run and a real dev/staging deployment don't collide.
 */
function storeRoot(): string {
  return process.env.KNOWLEDGE_UPLOAD_STORE_ROOT ?? path.join(process.cwd(), ".data", "knowledge-uploads");
}

/** Sanitizes a tenant id / storage ref against path traversal before it is ever
 *  used to build a filesystem path — never trust a caller-supplied identifier to be
 *  path-safe by construction, per this project's own security-review baseline. */
function assertPathSafeSegment(segment: string, label: string): void {
  if (segment.includes("..") || segment.includes("/") || segment.includes("\\") || segment.length === 0) {
    throw new Error(`upload-store: unsafe ${label} segment: ${JSON.stringify(segment)}`);
  }
}

/**
 * Stores raw uploaded bytes for a tenant and returns the opaque `storageRef` to
 * persist on `knowledge_source.locator.storageRef` (`KnowledgeSourceLocator`'s
 * `Upload` variant). The ref is a random uuid, not the original filename — the
 * filename/mimeType are captured separately in the locator, so this store never
 * needs to sanitize an attacker-supplied filename for its own path.
 */
export async function putUpload(tenantId: string, content: Buffer | string): Promise<string> {
  assertPathSafeSegment(tenantId, "tenantId");
  const storageRef = randomUUID();
  const dir = path.join(storeRoot(), tenantId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, storageRef), content);
  return storageRef;
}

/** Reads back raw bytes for a previously-stored upload. Throws (never silently
 *  returns empty) if the ref doesn't resolve — a missing upload at Ingest time is a
 *  real per-document failure the Ingest stage must record, not swallow. */
export async function getUpload(tenantId: string, storageRef: string): Promise<Buffer> {
  assertPathSafeSegment(tenantId, "tenantId");
  assertPathSafeSegment(storageRef, "storageRef");
  return readFile(path.join(storeRoot(), tenantId, storageRef));
}
