/**
 * In-memory `ThemeRepository`, for `application/*.test.ts`. Mirrors the shape and
 * naming of `modules/iam/testing/fakes.ts` for the rest of this codebase.
 *
 * Carries no system-default colours: the interface it fakes has no such method (the
 * system tier is `@shj3/tokens`' own static export, read directly by whatever calls
 * this fake — see `ThemeRepository`'s doc comment for why).
 *
 * ## The SkinEditor extension (2026-09-09)
 *
 * `tenantSkins` simulates the tenant's own `Skins` table well enough to exercise
 * `manage-appearance.ts`'s orchestration without a database: a plain `Map` keyed by
 * id, an `activeSkinId` pointer standing in for `TenantBranding.activeSkinId`, and a
 * hand-rolled re-implementation of `TR_Skins_blockActiveDeletion` in
 * `deleteTenantSkin` below — the one piece of behaviour worth faking explicitly
 * rather than trusting "the real trigger will catch it," since a fake that always
 * allows deletion would let `manage-appearance.test.ts` believe the blocked-delete
 * path works when only the real Prisma adapter has ever exercised it.
 */

import type {
  CreateTenantSkinInput,
  SaveBrandAssetInput,
  SaveBrandAssetResult,
  SaveTenantAppearanceInput,
  TenantBrandingScalars,
  TenantBrandingSnapshot,
  TenantSkinDeletionResult,
  TenantSkinDetail,
  TenantSkinSummary,
  ThemeRepository,
  UserPreferenceScalarsInput,
  UserPreferenceSnapshot,
} from "../ports/theme-repository.js";
import type { BrandAssetKind } from "../domain/brand-asset.js";

/** Internal-only row shape — richer than `TenantSkinSummary`/`Detail` because the
 *  fake also needs to hand back an id-stable, mutable record across calls. */
interface FakeTenantSkinRow {
  id: string;
  name: string;
  description: string | null;
  light: Record<string, string>;
  dark: Record<string, string>;
  updatedAt: string;
}

let fakeIdSequence = 0;
/** Deterministic, collision-free ids — a real ULID's shape is not needed here, only
 *  its "stable, unique per row" property, which the tests actually rely on. */
function nextFakeId(): string {
  fakeIdSequence += 1;
  return `fake-skin-${fakeIdSequence}`;
}

export interface FakeThemeRepositoryState {
  tenantBranding: TenantBrandingSnapshot | null;
  usersByStaffId: Map<string, UserPreferenceSnapshot>;
  tenantSkins: Map<string, FakeTenantSkinRow>;
  activeSkinId: string | null;
  /** Keyed by `${checksum}:${kind}`, mirroring `UQ_BrandAssets_checksum_kind` —
   *  the one behaviour worth faking explicitly (same reasoning as
   *  `deleteTenantSkin`'s trigger re-implementation below): a fake that always
   *  creates a new row would never exercise `UploadBrandAsset`'s dedup-cleanup
   *  path. */
  brandAssetsByChecksumAndKind: Map<string, { id: string; url: string }>;
}

export class FakeThemeRepository implements ThemeRepository {
  readonly state: FakeThemeRepositoryState;

  constructor(
    initial: {
      tenantBranding?: TenantBrandingSnapshot | null;
      users?: ReadonlyMap<string, UserPreferenceSnapshot>;
      tenantSkins?: ReadonlyMap<string, FakeTenantSkinRow>;
      activeSkinId?: string | null;
    } = {},
  ) {
    this.state = {
      tenantBranding: initial.tenantBranding ?? null,
      usersByStaffId: new Map(initial.users ?? []),
      tenantSkins: new Map(initial.tenantSkins ?? []),
      activeSkinId: initial.activeSkinId ?? null,
      brandAssetsByChecksumAndKind: new Map(),
    };
  }

  async readTenantBranding(): Promise<TenantBrandingSnapshot | null> {
    return this.state.tenantBranding;
  }

  async readUserPreference(staffUserId: string): Promise<UserPreferenceSnapshot | null> {
    return this.state.usersByStaffId.get(staffUserId) ?? null;
  }

  async resetTenantBrandingToSystemDefault(): Promise<void> {
    // A real delete of the singleton, mirroring the real adapter — see the port's own
    // doc comment for why this is a delete rather than repointing activeSkinId.
    this.state.tenantBranding = null;
  }

  async resetUserPreferenceToDefault(staffUserId: string): Promise<void> {
    this.state.usersByStaffId.set(staffUserId, {
      mode: null,
      density: null,
      direction: null,
      fontSize: null,
      reducedMotion: null,
      personalSkinColors: null,
    });
  }

  async listTenantSkins(): Promise<readonly TenantSkinSummary[]> {
    return [...this.state.tenantSkins.values()]
      .map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        isActive: row.id === this.state.activeSkinId,
        updatedAt: row.updatedAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async readTenantSkinDetail(skinId: string): Promise<TenantSkinDetail | null> {
    const row = this.state.tenantSkins.get(skinId);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      isActive: row.id === this.state.activeSkinId,
      updatedAt: row.updatedAt,
      light: row.light as TenantSkinDetail["light"],
      dark: row.dark as TenantSkinDetail["dark"],
    };
  }

  /** Rebuilds the fake's `TenantBrandingSnapshot` from `branding` + whichever skin
   *  is now active — the fake's stand-in for the real adapter's `include` join.
   *  Brand asset URLs are carried over from whatever the row already had: a
   *  colour/scalar save must never silently clear an upload, the same "one column
   *  per write" discipline `PrismaThemeRepository.saveBrandAsset`'s own doc
   *  comment states for the real adapter. */
  private applyBrandingScalars(
    branding: TenantBrandingScalars,
    activeSkinId: string,
    activeSkinColors: TenantBrandingSnapshot["activeSkinColors"],
  ): void {
    const previous = this.state.tenantBranding;
    this.state.activeSkinId = activeSkinId;
    this.state.tenantBranding = {
      ...branding,
      activeSkinColors,
      logoLightUrl: previous?.logoLightUrl ?? null,
      logoDarkUrl: previous?.logoDarkUrl ?? null,
      faviconUrl: previous?.faviconUrl ?? null,
    };
  }

  async saveTenantAppearance(
    input: SaveTenantAppearanceInput,
  ): Promise<{ ok: true; skinId: string } | { ok: false; reason: "nameTaken" }> {
    // Mirrors the real `UQ_Skins_name` filtered unique index: a collision with any
    // OTHER skin's name (never itself, on the update branch) is a name-taken
    // refusal, not a silent overwrite.
    const collision = [...this.state.tenantSkins.entries()].some(
      ([id, skin]) => id !== input.editingSkinId && skin.name === input.skinName,
    );
    if (collision) return { ok: false, reason: "nameTaken" };

    const now = new Date().toISOString();
    const skinId = input.editingSkinId ?? nextFakeId();

    this.state.tenantSkins.set(skinId, {
      id: skinId,
      name: input.skinName,
      description: input.skinDescription,
      light: input.light as Record<string, string>,
      dark: input.dark as Record<string, string>,
      updatedAt: now,
    });

    this.applyBrandingScalars(input.branding, skinId, { light: input.light, dark: input.dark });
    return { ok: true, skinId };
  }

  async applyExistingTenantSkin(
    skinId: string,
    baseline: TenantBrandingScalars,
  ): Promise<{ skinId: string }> {
    const row = this.state.tenantSkins.get(skinId);
    if (!row) {
      throw new Error(`applyExistingTenantSkin: no such tenant skin "${skinId}" (fake repository)`);
    }
    const branding = this.state.tenantBranding
      ? {
          appTitle: this.state.tenantBranding.appTitle,
          defaultMode: this.state.tenantBranding.defaultMode,
          defaultDirection: this.state.tenantBranding.defaultDirection,
          density: this.state.tenantBranding.density,
          fontSize: this.state.tenantBranding.fontSize,
          shadowDepth: this.state.tenantBranding.shadowDepth,
          sidebarStyle: this.state.tenantBranding.sidebarStyle,
        }
      : baseline;
    this.applyBrandingScalars(branding, skinId, {
      light: row.light as TenantBrandingSnapshot["activeSkinColors"]["light"],
      dark: row.dark as TenantBrandingSnapshot["activeSkinColors"]["dark"],
    });
    return { skinId };
  }

  async createTenantSkin(input: CreateTenantSkinInput): Promise<{ skinId: string }> {
    const skinId = nextFakeId();
    this.state.tenantSkins.set(skinId, {
      id: skinId,
      name: input.name,
      description: input.description,
      light: input.light as Record<string, string>,
      dark: input.dark as Record<string, string>,
      updatedAt: new Date().toISOString(),
    });
    return { skinId };
  }

  async renameTenantSkin(skinId: string, name: string, description: string | null): Promise<void> {
    const row = this.state.tenantSkins.get(skinId);
    if (!row) {
      throw new Error(`renameTenantSkin: no such tenant skin "${skinId}" (fake repository)`);
    }
    row.name = name;
    row.description = description;
    row.updatedAt = new Date().toISOString();
  }

  /** Re-implements `TR_Skins_blockActiveDeletion`'s guard in memory (see this
   *  file's own module comment for why this one behaviour is faked explicitly
   *  rather than always allowed). */
  async deleteTenantSkin(skinId: string): Promise<TenantSkinDeletionResult> {
    if (skinId === this.state.activeSkinId) {
      return {
        blocked: true,
        reason:
          "A skin currently applied as active tenant branding cannot be deleted. Apply a different skin first.",
      };
    }
    this.state.tenantSkins.delete(skinId);
    return { blocked: false };
  }

  async applyUserSkin(staffUserId: string, skinId: string | null): Promise<void> {
    const existing = this.state.usersByStaffId.get(staffUserId);
    const personalSkinColors =
      skinId === null
        ? null
        : (() => {
            const row = this.state.tenantSkins.get(skinId);
            if (!row) {
              throw new Error(`applyUserSkin: no such tenant skin "${skinId}" (fake repository)`);
            }
            return {
              light: row.light as TenantBrandingSnapshot["activeSkinColors"]["light"],
              dark: row.dark as TenantBrandingSnapshot["activeSkinColors"]["dark"],
            };
          })();

    this.state.usersByStaffId.set(staffUserId, {
      mode: existing?.mode ?? null,
      density: existing?.density ?? null,
      direction: existing?.direction ?? null,
      fontSize: existing?.fontSize ?? null,
      reducedMotion: existing?.reducedMotion ?? null,
      personalSkinColors,
    });
  }

  async saveUserPreferenceScalars(
    staffUserId: string,
    input: UserPreferenceScalarsInput,
  ): Promise<void> {
    const existing = this.state.usersByStaffId.get(staffUserId);
    this.state.usersByStaffId.set(staffUserId, {
      mode: input.mode,
      density: input.density,
      direction: input.direction,
      fontSize: input.fontSize,
      reducedMotion: input.reducedMotion,
      personalSkinColors: existing?.personalSkinColors ?? null,
    });
  }

  /** Re-implements `UQ_BrandAssets_checksum_kind`'s dedup and the "no
   *  TenantBranding row yet" refusal in memory — the two behaviours
   *  `UploadBrandAsset`'s own tests actually depend on (see this file's own
   *  module comment for why a handful of real constraints are faked explicitly
   *  rather than always allowed). Touches only the ONE column matching
   *  `input.kind`, mirroring `PrismaThemeRepository.saveBrandAsset`'s real
   *  "never any other TenantBranding scalar" contract. */
  async saveBrandAsset(input: SaveBrandAssetInput): Promise<SaveBrandAssetResult> {
    const branding = this.state.tenantBranding;
    if (!branding) {
      return { ok: false, reason: "noTenantBranding" };
    }

    const dedupeKey = `${input.checksum}:${input.kind}`;
    const existingAsset = this.state.brandAssetsByChecksumAndKind.get(dedupeKey);
    const assetId = existingAsset?.id ?? nextFakeId();
    const url = existingAsset?.url ?? input.url;
    if (!existingAsset) {
      this.state.brandAssetsByChecksumAndKind.set(dedupeKey, { id: assetId, url });
    }

    const previousUrl = urlForBrandAssetKind(branding, input.kind);
    this.state.tenantBranding = { ...branding, ...patchForBrandAssetKind(input.kind, url) };

    return { ok: true, assetId, url, previousUrl };
  }
}

function urlForBrandAssetKind(
  branding: TenantBrandingSnapshot,
  kind: BrandAssetKind,
): string | null {
  if (kind === "LogoLight") return branding.logoLightUrl;
  if (kind === "LogoDark") return branding.logoDarkUrl;
  return branding.faviconUrl;
}

/** Only the ONE field `kind` names — never resets the other two, unlike a naive
 *  "rebuild all three" patch would. */
function patchForBrandAssetKind(
  kind: BrandAssetKind,
  url: string,
): Partial<Pick<TenantBrandingSnapshot, "logoLightUrl" | "logoDarkUrl" | "faviconUrl">> {
  if (kind === "LogoLight") return { logoLightUrl: url };
  if (kind === "LogoDark") return { logoDarkUrl: url };
  return { faviconUrl: url };
}
