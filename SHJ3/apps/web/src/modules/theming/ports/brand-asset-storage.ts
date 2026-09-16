/**
 * Where a validated brand asset's BYTES live — deliberately separate from
 * `ThemeRepository` (which owns the `BrandAsset` ROW: checksum, kind, and the
 * `TenantBranding` foreign key that makes an asset "the tenant's active logo").
 * Same ports-and-adapters split this module already draws between "the database"
 * and "the binary" nowhere else needed until this wave — a real storage backend is
 * infrastructure, exactly the kind of thing `architecture.md §4` puts behind a port
 * rather than letting a Server Action reach for `node:fs` directly.
 *
 * The real adapter (`adapters/outbound/fs/local-brand-asset-storage.ts`) is local
 * filesystem storage under `apps/web/public/uploads/brand-assets/` — this project's
 * own "don't fabricate a third-party credential" precedent (no S3/Azure Blob
 * credentials exist in this dev/local environment) applied to binary storage
 * instead of a channel adapter. A real cloud blob adapter (S3, Azure Blob) behind
 * this SAME port is the named production-scale follow-up — see that adapter's own
 * doc comment and `tasks/todo.md`'s review entry for this wave.
 */

import type { BrandAssetKind } from "../domain/brand-asset.js";

export interface BrandAssetStoreInput {
  readonly kind: BrandAssetKind;
  readonly bytes: Uint8Array;
  /** Server-DETECTED extension (`detectImageType`'s output) — never the client's
   *  original filename, which this port's real adapter must not trust for path
   *  construction (path-traversal safety). */
  readonly extension: "png" | "webp" | "ico";
}

export interface BrandAssetStorage {
  /** Persists bytes under a server-generated name and returns the URL the app
   *  renders (`<img src>` / `<link rel="icon" href>`). Never accepts or derives a
   *  name from client input. */
  store(input: BrandAssetStoreInput): Promise<{ readonly url: string }>;

  /**
   * Best-effort delete of a previously-stored asset (a replaced logo, or a file
   * written for an upload that turned out not to persist — see
   * `UploadBrandAsset`'s own doc comment for both cases). MUST NOT throw: a
   * missing file, or any other removal failure, is logged and swallowed here —
   * failing to reclaim disk space is never a reason to fail the request that
   * already succeeded (or already failed for its own, unrelated reason).
   */
  remove(url: string): Promise<void>;
}
