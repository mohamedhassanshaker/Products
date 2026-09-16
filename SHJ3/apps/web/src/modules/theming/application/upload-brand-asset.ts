/**
 * `UploadBrandAsset` — the real write path closing the gap `tasks/todo.md`'s
 * SkinEditor review entry named: "No `BrandAsset`-writing adapter exists anywhere
 * in this codebase." Orchestrates real, server-side validation (§9.1's Brand
 * section: "Logo light, logo dark, ... favicon (upload -> assetId)") over the two
 * ports this wave adds: `BrandAssetStorage` (the bytes) and `ThemeRepository`'s new
 * `saveBrandAsset` (the row + the `TenantBranding` foreign key).
 *
 * `node:crypto`'s `createHash` is used directly here for the upload's checksum
 * (`UQ_BrandAssets_checksum_kind`'s dedup key) — this project's own "no vendor
 * imports" convention (stated in `manage-appearance.ts`'s doc comment) is about
 * framework/database/cloud SDKs a real port exists to abstract, not the language
 * runtime's own standard library; `newUlid()` (an adapter-level helper elsewhere
 * in this codebase) makes the identical choice for the identical reason. There is
 * no vendor here to swap — every runtime this app could ever target still has a
 * SHA-256 implementation.
 */

import { createHash } from "node:crypto";
import {
  detectImageType,
  MAX_BRAND_ASSET_BYTES,
  readPngDimensions,
} from "../domain/brand-asset.js";
import type { BrandAssetKind } from "../domain/brand-asset.js";
import type { BrandAssetStorage } from "../ports/brand-asset-storage.js";
import type { ThemeRepository } from "../ports/theme-repository.js";

export interface UploadBrandAssetCommand {
  readonly kind: BrandAssetKind;
  readonly bytes: Uint8Array;
  /** Display metadata only (`BrandAssets.fileName`) — never used to build a
   *  storage path or to decide the file's real type. */
  readonly fileName: string;
  readonly uploadedByStaffUserId: string;
}

export type UploadBrandAssetErrorCode = "invalidType" | "tooLarge" | "noTenantBranding";

export type UploadBrandAssetResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly errorCode: UploadBrandAssetErrorCode };

export class UploadBrandAsset {
  constructor(
    private readonly repo: ThemeRepository,
    private readonly storage: BrandAssetStorage,
  ) {}

  async execute(command: UploadBrandAssetCommand): Promise<UploadBrandAssetResult> {
    // Size cap enforced server-side, on the real byte length — never trusting a
    // client-reported `Content-Length` or the file picker's own `accept` filter
    // (both are advisory only; this project's own CLAUDE.md requires real
    // server-side enforcement for anything touching file/object storage).
    if (command.bytes.byteLength === 0 || command.bytes.byteLength > MAX_BRAND_ASSET_BYTES) {
      return { ok: false, errorCode: "tooLarge" };
    }

    // Real content sniffing (magic bytes), never the client's Content-Type header
    // or the file's extension — see `detectImageType`'s own doc comment for the
    // full security reasoning (this is also where an SVG upload is refused).
    const detected = detectImageType(command.bytes);
    if (!detected) {
      return { ok: false, errorCode: "invalidType" };
    }

    const dimensions = detected.extension === "png" ? readPngDimensions(command.bytes) : null;
    const checksum = createHash("sha256").update(command.bytes).digest("hex");

    // Store the bytes BEFORE writing any row: `saveBrandAsset` needs the real,
    // already-persisted URL to write into `BrandAssets.storageRef`. If the
    // repository then refuses the write (no TenantBranding row yet, or the
    // dedup path finds an identical asset already stored under a different URL),
    // the file just written here is cleaned up below — never left orphaned.
    const stored = await this.storage.store({
      kind: command.kind,
      bytes: command.bytes,
      extension: detected.extension,
    });

    const saveResult = await this.repo.saveBrandAsset({
      kind: command.kind,
      // NVarChar(260) — truncate defensively rather than let a pathological
      // client-supplied filename overflow the column (this is display metadata
      // only; truncation here cannot corrupt anything the app depends on).
      fileName: command.fileName.slice(0, 260),
      mimeType: detected.mimeType,
      byteSize: command.bytes.byteLength,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      checksum,
      url: stored.url,
      uploadedByStaffUserId: command.uploadedByStaffUserId,
    });

    if (!saveResult.ok) {
      await this.storage.remove(stored.url);
      return { ok: false, errorCode: saveResult.reason };
    }

    if (saveResult.url !== stored.url) {
      // Deduped onto an already-stored, byte-identical asset (UQ_BrandAssets_
      // checksum_kind) — the file this call just wrote is redundant.
      await this.storage.remove(stored.url);
    } else if (saveResult.previousUrl && saveResult.previousUrl !== saveResult.url) {
      // A real replace: the asset this upload's `kind` used to point at is no
      // longer referenced by anything — best-effort reclaim its bytes.
      await this.storage.remove(saveResult.previousUrl);
    }

    return { ok: true, url: saveResult.url };
  }
}
