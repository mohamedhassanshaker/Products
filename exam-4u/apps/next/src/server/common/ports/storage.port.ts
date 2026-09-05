import type { Readable } from 'node:stream';

/**
 * Cross-cutting port over blob storage — ported verbatim from
 * `legacy/api/src/common/ports/storage.port.ts`. Kept under `common/ports/` (no module-boundary
 * ESLint rule, matching `PasswordHasherPort`'s identical precedent) rather than inside any single
 * module's `domain/ports/` — this phase's avatar upload (`profile`) and signed file delivery
 * (`files`) both need it, with no single natural owning bounded context.
 *
 * Only `infrastructure/storage/**` may import a concrete storage SDK/`node:fs` driver; every
 * consumer depends on this interface instead.
 */
export interface StoragePort {
  /** Writes `data` under `key`, creating any needed parent structure. Returns the final size written. */
  put(key: string, data: Buffer | Readable, contentType?: string): Promise<{ key: string; size: number }>;

  /** Reads back a previously stored object as a stream, optionally a byte range. */
  getStream(
    key: string,
    range?: { start: number; end: number },
  ): Promise<{ stream: Readable; size: number; contentType: string }>;

  /** Returns size/content-type metadata for `key`, or `null` if it does not exist. */
  stat(key: string): Promise<{ size: number; contentType: string } | null>;

  /** Deletes a single object. A no-op (not an error) if `key` does not exist. */
  delete(key: string): Promise<void>;

  /** Deletes every object whose key starts with `prefix` (used for tenant purge). */
  deletePrefix(prefix: string): Promise<void>;

  /** Returns whether `key` currently exists. */
  exists(key: string): Promise<boolean>;
}
