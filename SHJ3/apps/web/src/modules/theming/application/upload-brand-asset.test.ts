import { describe, expect, it } from "vitest";
import { semanticColors } from "@shj3/tokens";
import { UploadBrandAsset } from "./upload-brand-asset.js";
import { FakeThemeRepository } from "../testing/fakes.js";
import type { BrandAssetStorage, BrandAssetStoreInput } from "../ports/brand-asset-storage.js";
import type { TenantBrandingSnapshot } from "../ports/theme-repository.js";

/** A real, valid PNG signature — enough for `detectImageType`/`readPngDimensions`
 *  (this file cares about orchestration, not image-parsing edge cases, which
 *  `domain/brand-asset.test.ts` already covers against a genuine 1x1 PNG). */
const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0,
  0, 0, 1,
]);

function branding(overrides: Partial<TenantBrandingSnapshot> = {}): TenantBrandingSnapshot {
  return {
    appTitle: "Tenant Assistant",
    defaultMode: "Light",
    defaultDirection: "LTR",
    density: "Comfortable",
    fontSize: "0.875rem",
    shadowDepth: "1",
    sidebarStyle: "neutral",
    activeSkinColors: { light: semanticColors.light, dark: semanticColors.dark },
    logoLightUrl: null,
    logoDarkUrl: null,
    faviconUrl: null,
    ...overrides,
  };
}

/** A real in-memory implementation of the storage PORT (not a mock of internals) —
 *  records every store/remove call so tests can assert the orchestration's real
 *  cleanup behaviour (never-orphan-a-file, never-double-write). */
class FakeBrandAssetStorage implements BrandAssetStorage {
  readonly stored: BrandAssetStoreInput[] = [];
  readonly removed: string[] = [];
  private counter = 0;

  async store(input: BrandAssetStoreInput): Promise<{ url: string }> {
    this.stored.push(input);
    this.counter += 1;
    return { url: `/uploads/brand-assets/tenant/${input.kind}-${this.counter}.${input.extension}` };
  }

  async remove(url: string): Promise<void> {
    this.removed.push(url);
  }
}

describe("UploadBrandAsset", () => {
  it("rejects an empty or oversized upload before touching storage", async () => {
    const repo = new FakeThemeRepository({ tenantBranding: branding() });
    const storage = new FakeBrandAssetStorage();
    const useCase = new UploadBrandAsset(repo, storage);

    const empty = await useCase.execute({
      kind: "Favicon",
      bytes: new Uint8Array(),
      fileName: "empty.png",
      uploadedByStaffUserId: "staff-1",
    });
    expect(empty).toEqual({ ok: false, errorCode: "tooLarge" });

    const oversized = await useCase.execute({
      kind: "Favicon",
      bytes: new Uint8Array(1_048_577),
      fileName: "huge.png",
      uploadedByStaffUserId: "staff-1",
    });
    expect(oversized).toEqual({ ok: false, errorCode: "tooLarge" });
    expect(storage.stored).toHaveLength(0);
  });

  it("rejects content that is not a real, recognised raster image — never touches storage", async () => {
    const repo = new FakeThemeRepository({ tenantBranding: branding() });
    const storage = new FakeBrandAssetStorage();
    const useCase = new UploadBrandAsset(repo, storage);

    const result = await useCase.execute({
      kind: "LogoLight",
      bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      fileName: "logo.svg",
      uploadedByStaffUserId: "staff-1",
    });

    expect(result).toEqual({ ok: false, errorCode: "invalidType" });
    expect(storage.stored).toHaveLength(0);
  });

  it("refuses the upload, and cleans up the just-written file, when no TenantBranding row exists yet", async () => {
    const repo = new FakeThemeRepository({ tenantBranding: null });
    const storage = new FakeBrandAssetStorage();
    const useCase = new UploadBrandAsset(repo, storage);

    const result = await useCase.execute({
      kind: "Favicon",
      bytes: PNG_BYTES,
      fileName: "favicon.png",
      uploadedByStaffUserId: "staff-1",
    });

    expect(result).toEqual({ ok: false, errorCode: "noTenantBranding" });
    // The file this call wrote before finding out no TenantBranding row exists
    // must not be left orphaned on disk.
    expect(storage.stored).toHaveLength(1);
    expect(storage.removed).toHaveLength(1);
    expect(storage.removed[0]).toMatch(/^\/uploads\/brand-assets\/tenant\/Favicon-1\.png$/);
  });

  it("persists a valid upload and returns the real, stored URL", async () => {
    const repo = new FakeThemeRepository({ tenantBranding: branding() });
    const storage = new FakeBrandAssetStorage();
    const useCase = new UploadBrandAsset(repo, storage);

    const result = await useCase.execute({
      kind: "LogoLight",
      bytes: PNG_BYTES,
      fileName: "logo.png",
      uploadedByStaffUserId: "staff-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.url).toMatch(/^\/uploads\/brand-assets\/tenant\/LogoLight-1\.png$/);
    expect(storage.removed).toHaveLength(0);

    const readBack = await repo.readTenantBranding();
    expect(readBack?.logoLightUrl).toBe(result.url);
    // A logo upload never touches the other two slots.
    expect(readBack?.logoDarkUrl).toBeNull();
    expect(readBack?.faviconUrl).toBeNull();
  });

  it("replacing an existing logo best-effort deletes the file it replaced", async () => {
    const repo = new FakeThemeRepository({
      tenantBranding: branding({ logoLightUrl: "/uploads/brand-assets/tenant/old-logo.png" }),
    });
    const storage = new FakeBrandAssetStorage();
    const useCase = new UploadBrandAsset(repo, storage);

    const result = await useCase.execute({
      kind: "LogoLight",
      bytes: PNG_BYTES,
      fileName: "new-logo.png",
      uploadedByStaffUserId: "staff-1",
    });

    expect(result.ok).toBe(true);
    expect(storage.removed).toEqual(["/uploads/brand-assets/tenant/old-logo.png"]);
  });

  it("re-uploading byte-identical content for the same kind dedupes and deletes the redundant file it just wrote", async () => {
    const repo = new FakeThemeRepository({ tenantBranding: branding() });
    const storage = new FakeBrandAssetStorage();
    const useCase = new UploadBrandAsset(repo, storage);

    const first = await useCase.execute({
      kind: "Favicon",
      bytes: PNG_BYTES,
      fileName: "favicon.png",
      uploadedByStaffUserId: "staff-1",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");

    const second = await useCase.execute({
      kind: "Favicon",
      bytes: PNG_BYTES,
      fileName: "favicon-again.png",
      uploadedByStaffUserId: "staff-1",
    });
    expect(second).toEqual({ ok: true, url: first.url });
    // The second call's own newly-written file (distinct URL, since the fake
    // storage mints a fresh one every call) must be cleaned up as redundant.
    expect(storage.removed).toHaveLength(1);
    expect(storage.removed[0]).not.toBe(first.url);
  });

  it("uploading a favicon never touches the logo slots, and vice versa", async () => {
    const repo = new FakeThemeRepository({
      tenantBranding: branding({ logoLightUrl: "/uploads/brand-assets/tenant/existing-logo.png" }),
    });
    const storage = new FakeBrandAssetStorage();
    const useCase = new UploadBrandAsset(repo, storage);

    await useCase.execute({
      kind: "Favicon",
      bytes: PNG_BYTES,
      fileName: "favicon.png",
      uploadedByStaffUserId: "staff-1",
    });

    const readBack = await repo.readTenantBranding();
    expect(readBack?.logoLightUrl).toBe("/uploads/brand-assets/tenant/existing-logo.png");
    expect(readBack?.faviconUrl).not.toBeNull();
  });
});
