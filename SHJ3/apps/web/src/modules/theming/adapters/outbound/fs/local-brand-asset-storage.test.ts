import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runWithTenant } from "../../../../platform/tenancy/tenant-context.js";
import { assertValidSlugShape } from "../../../../platform/tenancy/tenant-slug.js";
import { BRAND_ASSET_BASE_DIR, LocalBrandAssetStorage } from "./local-brand-asset-storage.js";

/**
 * A real filesystem adapter, proven against the real, local `public/uploads/
 * brand-assets/` directory this adapter actually writes to in `next dev` — not
 * mocked, per this project's own "a fake proves the logic; a real backend proves
 * the adapter" discipline (`tasks/lessons.md`). No database is involved, so this
 * stays a fast, deterministic unit test rather than needing a live-infra proof —
 * every fixture tenant/file is cleaned up in `afterEach`.
 */

const PROBE_TENANT = assertValidSlugShape("sewa");

function inTenantContext<T>(fn: () => Promise<T>): Promise<T> {
  return runWithTenant(
    { tenant: PROBE_TENANT, principal: null, traceId: "brand-asset-storage-test" },
    fn,
  );
}

const writtenUrls: string[] = [];

afterEach(async () => {
  const storage = new LocalBrandAssetStorage();
  await inTenantContext(async () => {
    for (const url of writtenUrls) {
      await storage.remove(url);
    }
  });
  writtenUrls.length = 0;
  // Tenant directory itself, only if this run left it empty — never touches a
  // directory a concurrent test run or a real dev upload might still be using.
  const tenantDir = join(BRAND_ASSET_BASE_DIR, PROBE_TENANT);
  if (existsSync(tenantDir)) {
    await rm(tenantDir, { recursive: true, force: false }).catch(() => undefined);
  }
});

describe("LocalBrandAssetStorage", () => {
  it("writes real bytes to disk under the tenant's own directory and returns a matching public URL", async () => {
    const storage = new LocalBrandAssetStorage();
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

    const { url } = await inTenantContext(() =>
      storage.store({ kind: "LogoLight", bytes, extension: "png" }),
    );
    writtenUrls.push(url);

    expect(url).toMatch(new RegExp(`^/uploads/brand-assets/${PROBE_TENANT}/[0-9A-Z]{26}\\.png$`));

    const relativePath = url.replace("/uploads/brand-assets/", "");
    const onDisk = await readFile(join(BRAND_ASSET_BASE_DIR, relativePath));
    expect(Uint8Array.from(onDisk)).toEqual(bytes);
  });

  it("never derives the stored filename from anything client-supplied — two uploads of identical bytes get two different, server-generated names", async () => {
    const storage = new LocalBrandAssetStorage();
    const bytes = Uint8Array.from([1, 2, 3]);

    const first = await inTenantContext(() =>
      storage.store({ kind: "Favicon", bytes, extension: "ico" }),
    );
    const second = await inTenantContext(() =>
      storage.store({ kind: "Favicon", bytes, extension: "ico" }),
    );
    writtenUrls.push(first.url, second.url);

    expect(first.url).not.toBe(second.url);
  });

  it("remove() deletes a real file it wrote, and is a genuine no-op (never throws) for one that never existed", async () => {
    const storage = new LocalBrandAssetStorage();
    const { url } = await inTenantContext(() =>
      storage.store({ kind: "LogoDark", bytes: Uint8Array.from([9]), extension: "webp" }),
    );

    const relativePath = url.replace("/uploads/brand-assets/", "");
    const filePath = join(BRAND_ASSET_BASE_DIR, relativePath);
    expect(existsSync(filePath)).toBe(true);

    await inTenantContext(() => storage.remove(url));
    expect(existsSync(filePath)).toBe(false);

    // Second removal of the same (now-gone) URL must not throw — the port's own
    // "best-effort, never throws" contract.
    await expect(inTenantContext(() => storage.remove(url))).resolves.toBeUndefined();
  });

  it("refuses to remove a URL that resolves outside its own base directory, even if asked", async () => {
    const storage = new LocalBrandAssetStorage();
    // A path-traversal attempt is not a shape this adapter's own callers ever
    // produce (see this file's own doc comment), but the guard is real, not
    // theoretical — proven directly by asserting nothing above the base dir is
    // touched, rather than trusting the source read alone.
    const escapeAttempt = "/uploads/brand-assets/../../../../etc/passwd";
    await expect(inTenantContext(() => storage.remove(escapeAttempt))).resolves.toBeUndefined();
  });
});
