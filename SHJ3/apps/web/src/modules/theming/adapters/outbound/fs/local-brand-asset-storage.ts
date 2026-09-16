/**
 * The real `BrandAssetStorage` adapter — local filesystem, under
 * `apps/web/public/uploads/brand-assets/<tenant>/`.
 *
 * ## Why local disk, and why this is NOT the production-scale answer
 *
 * No S3/Azure Blob credentials exist anywhere in this dev/local environment
 * (confirmed by grep, matching this project's own repeated "don't fabricate a
 * third-party credential" precedent from the channels/WhatsApp wave). `apps/web/
 * public/` is served directly by Next.js at request time from disk — true in both
 * `next dev` and `next start` (this app does NOT set `output: "standalone"` in
 * `next.config.ts`, confirmed by reading it directly; a standalone build would need
 * its own separate handling, since that mode snapshots `public/` at build time and
 * would not see a file written afterward — named here as the real, concrete reason
 * this adapter is a dev/local answer, not a deployed-container one).
 *
 * The real, named production follow-up is a cloud blob adapter (S3, Azure Blob)
 * implementing this SAME `BrandAssetStorage` port — every caller (`UploadBrandAsset`)
 * already depends only on the port, so swapping the adapter is the entire migration.
 *
 * ## Security: path safety and served-content safety
 *
 * The stored filename is always server-generated (`newUlid()` + the server-DETECTED
 * extension from `detectImageType`, never the client's original filename or a
 * client-supplied extension) — there is no code path from a client-supplied string
 * to a filesystem path here at all, which is what makes path traversal structurally
 * unreachable rather than merely filtered. `remove()` additionally re-validates that
 * a URL it is asked to delete resolves inside this adapter's own base directory
 * before unlinking, as defence in depth against a future caller passing an
 * unexpected value — belt-and-braces, not the primary guarantee.
 *
 * Served content is safe by construction: `detectImageType` (domain/brand-asset.ts)
 * only ever returns PNG/WebP/ICO — no SVG, so no script-capable markup can ever
 * reach this adapter to be served back to an admin's browser (see that module's own
 * doc comment for the full XSS reasoning). Next's static file serving sets
 * `Content-Type` from the file extension, which is exactly the server-detected one
 * this adapter writes, never a client-supplied header.
 */

import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentTenant } from "../../../../platform/tenancy/tenant-context.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  BrandAssetStorage,
  BrandAssetStoreInput,
} from "../../../ports/brand-asset-storage.js";

const OPERATION = "brand asset storage";

/** `apps/web/public/uploads/brand-assets` — six levels up from this file's own
 *  directory (`src/modules/theming/adapters/outbound/fs/`) to `apps/web/`.
 *
 *  Computed from `import.meta.url`, NOT `import.meta.dirname` — confirmed by a
 *  real, live `next dev` 500 (`TypeError: The "paths[0]" argument must be of type
 *  string. Received undefined`) the first time this route was actually hit:
 *  `next.config.ts`'s own `ROOT_ENV_PATH` uses `import.meta.dirname` safely
 *  because Next's config loader runs it as plain, native Node ESM, but THIS file
 *  is application source webpack bundles for the RSC server build, and this
 *  webpack version does not populate `import.meta.dirname` for a bundled module —
 *  only `import.meta.url`, which webpack does correctly rewrite per-module. A
 *  convention that is safe in one execution context (a config file Node loads
 *  directly) is not automatically safe in a different one (a bundled server
 *  module).
 *
 *  A SECOND, independent webpack gotcha found the same way, one fix later:
 *  `fileURLToPath(new URL(".", import.meta.url))` — the standard, widely-
 *  documented Node idiom for "this file's own directory" — produced a real
 *  `Module not found: Can't resolve "."` webpack build error instead. Webpack
 *  statically special-cases the literal syntactic pattern `new URL(x, import.meta.
 *  url)` as an asset reference to bundle (its own documented `import.meta.url`
 *  asset-handling feature), and eagerly tries to resolve `"."` as a module
 *  specifier rather than ever executing the expression as a plain runtime `URL`
 *  construction. Passing the un-wrapped `import.meta.url` string straight into
 *  `fileURLToPath()` (no `new URL()` call for webpack's static analysis to catch)
 *  sidesteps this entirely. Both failures were found by actually loading this
 *  route through a real `next dev`, not by reasoning about webpack's ESM support
 *  from documentation — see `tasks/lessons.md` for the generalised lesson this
 *  wave adds from it. Exported so this adapter's own real filesystem test can
 *  assert against it directly rather than re-deriving it. */
export const BRAND_ASSET_BASE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../../public/uploads/brand-assets",
);

const PUBLIC_URL_PREFIX = "/uploads/brand-assets";

export class LocalBrandAssetStorage implements BrandAssetStorage {
  async store(input: BrandAssetStoreInput): Promise<{ readonly url: string }> {
    const tenant = currentTenant(OPERATION);
    const tenantDir = join(BRAND_ASSET_BASE_DIR, tenant);
    await mkdir(tenantDir, { recursive: true });

    const fileName = `${newUlid()}.${input.extension}`;
    const filePath = join(tenantDir, fileName);
    await writeFile(filePath, input.bytes, { mode: 0o644 });

    return { url: `${PUBLIC_URL_PREFIX}/${tenant}/${fileName}` };
  }

  async remove(url: string): Promise<void> {
    if (!url.startsWith(`${PUBLIC_URL_PREFIX}/`)) return;
    const relativePath = url.slice(PUBLIC_URL_PREFIX.length + 1);
    const filePath = resolve(BRAND_ASSET_BASE_DIR, relativePath);

    // Defence in depth: never unlink outside this adapter's own base directory,
    // even though every real caller only ever passes back a URL this adapter
    // itself minted (see this file's own doc comment).
    if (relative(BRAND_ASSET_BASE_DIR, filePath).startsWith("..")) return;

    try {
      await unlink(filePath);
    } catch (error) {
      // Best-effort by contract (the port's own doc comment) — a missing file (a
      // repeat cleanup call, a file removed out-of-band) is not an error worth
      // surfacing to the caller, which has already succeeded or failed for its
      // own, unrelated reason by the time this runs.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(`LocalBrandAssetStorage.remove: failed to delete "${filePath}"`, error);
      }
    }
  }
}
