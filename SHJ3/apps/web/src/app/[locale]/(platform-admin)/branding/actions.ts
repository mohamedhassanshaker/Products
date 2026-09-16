"use server";

/**
 * Server Actions for `/branding` (Part D + E of the platform-admin wave) — a
 * platform operator's real, cross-tenant view/edit of ANY tenant's branding.
 *
 * ## The rebind, and why it is the whole mechanism
 *
 * `getTenantDb()` has no `platformScope` gate (only `getPlatformDb()` does) — it
 * resolves purely from whichever tenant is ambiently bound via `runWithTenant()`.
 * So `withTargetTenant()` below opens tenant X's branding by rebinding
 * `runWithTenant` to X for one call's duration — the same rebind-to-a-resolved-
 * tenant shape `signInWithPassword` already performs (`next-request-context.ts`),
 * just gated by `requirePlatformOperator()` and paired with an explicit audit
 * entry instead of ambient. This reuses `ManageAppearance`/`PrismaThemeRepository`
 * completely unchanged — they only ever know "the ambient tenant," which is
 * exactly what makes rebinding work.
 *
 * The real-tenant existence check (ADR-0002 rule 4) happens INSIDE the rebind,
 * not before it: `tenantRegistry().findBySlug()` reads `platform.Tenants` via
 * `getPlatformDb()`, which only requires *some* `platformScope` to be bound, not
 * a specific one — so checking after rebinding to `"branding-override"` (rather
 * than before, with no scope bound at all) is what lets this one lookup satisfy
 * both "validate before touching anything else" and "never call `getPlatformDb()`
 * with no scope bound."
 *
 * ## Personal preference is the one exception, deliberately NOT rebound
 *
 * `applyPersonalSkinAction`/`savePersonalPreferenceAction` write the SIGNED-IN
 * OPERATOR's own `UserThemePreference` row, keyed by `principal.id` in whichever
 * tenant schema is ambient. Rebinding those two to the tenant being *viewed* would
 * silently scatter one operator's personal preference across every tenant they
 * ever inspect, which is not what "personal" means. Both run in the operator's
 * own ambient tenant (the real Platform tenant, Part B) — identical in effect to
 * how `/settings/appearance`'s own personal-preference actions already behave for
 * any ordinary staff member in their own tenant.
 *
 * Every action still requires `requirePlatformOperator()` — including reads —
 * because any cross-tenant reach at all is the boundary being protected here,
 * unlike `/settings/appearance`'s own ungated reads of the caller's OWN tenant.
 */

import { randomUUID } from "node:crypto";
import { getTranslations } from "next-intl/server";
import { parseSkinDocument, resolveSkinTokens, systemSkin } from "@shj3/tokens";
import type { SemanticColorTokens } from "@shj3/tokens";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { runWithTenant } from "../../../../modules/platform/tenancy/tenant-context.js";
import type { Principal } from "../../../../modules/platform/tenancy/tenant-context.js";
import { assertValidSlugShape, type TenantSlug } from "../../../../modules/platform/tenancy/tenant-slug.js";
import { SYSTEM_DEFAULT_SKIN_ID } from "../../../../modules/theming/application/manage-appearance.js";
import { systemFallbackAppearance } from "../../../../modules/theming/domain/theme.js";
import type {
  SkinEditorImportResult,
  SkinEditorSaveInput,
  SkinEditorSaveResult,
} from "../../../../components/patterns/skin-editor/skin-editor.js";
import type { SkinEditorDeletionResult } from "../../../../components/patterns/skin-editor/skin-editor-types.js";
import type { BrandAssetKind } from "../../../../modules/theming/domain/brand-asset.js";
import type { UploadBrandAssetErrorCode } from "../../../../modules/theming/application/upload-brand-asset.js";
import {
  auditSink,
  environment,
  manageAppearance,
  platformOperatorGate,
  tenantRegistry,
  themeRepository,
  uploadBrandAsset,
} from "./composition.js";

const FALLBACK_LOCALE_DIRECTION = "LTR" as const;

/**
 * Whether `fn`'s own result says nothing actually applied — a blocked contrast save
 * (`{ok:false}`), a name collision (`{ok:false, nameTaken:true}`), or a delete refused
 * by `TR_Skins_blockActiveDeletion` (`{blocked:true}`). Auditing "Platform operator
 * edited tenant X's branding" for one of these would be a false record: nothing about
 * the tenant's real branding changed, only that an attempt was refused.
 */
function isNoOpResult(result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false;
  if ("ok" in result && (result as { ok: unknown }).ok === false) return true;
  if ("blocked" in result && (result as { blocked: unknown }).blocked === true) return true;
  return false;
}

/**
 * Gate + validate + rebind + audit, in one place — every tenant-wide (non-personal)
 * action below is a thin wrapper over this. `fn` receives the acting principal, for
 * `updatedByStaffUserId`-shaped fields that must name who actually made the change.
 */
async function withTargetTenant<T>(
  rawTargetSlug: string,
  operation: string,
  action: string,
  summary: string,
  fn: (principal: Principal) => Promise<T>,
): Promise<T> {
  return withStaffAuth(async ({ principal }) => {
    await platformOperatorGate().execute(principal, operation);
    const slug: TenantSlug = assertValidSlugShape(rawTargetSlug);

    return runWithTenant(
      {
        tenant: slug,
        principal,
        traceId: randomUUID().replace(/-/g, ""),
        platformScope: "branding-override",
      },
      async () => {
        const target = await tenantRegistry().findBySlug(slug);
        if (!target) {
          throw new Error(`No such tenant: "${rawTargetSlug}".`);
        }

        const result = await fn(principal);

        if (!isNoOpResult(result)) {
          await auditSink().record({
            actor: { kind: "Principal", principal },
            action,
            target: { kind: "Tenant", labelSnapshot: slug },
            summary,
            environmentKey: environment(),
            tenant: { slugSnapshot: slug },
          });
        }
        return result;
      },
    );
  });
}

export async function saveTenantAppearanceAction(
  targetSlug: string,
  input: SkinEditorSaveInput,
): Promise<SkinEditorSaveResult> {
  return withTargetTenant(
    targetSlug,
    "platform.branding.save",
    "tenant.branding.override",
    `Platform operator edited tenant "${targetSlug}"'s branding.`,
    async (principal) => {
      const result = await manageAppearance().saveTenantAppearance({
        editingSkinId: input.editingSkinId,
        skinName: input.skinName,
        skinDescription: input.skinDescription,
        light: input.light,
        dark: input.dark,
        branding: input.branding,
        // The ACTING operator, not a synthetic system id — an honest "who changed
        // this" for a tenant that never granted this person appearance:manage.
        updatedByStaffUserId: principal.id,
      });
      if (result.ok) {
        return { ok: true, skinId: result.skinId, lightReport: null, darkReport: null } as const;
      }
      return {
        ok: false,
        lightReport: result.lightReport,
        darkReport: result.darkReport,
        nameTaken: result.nameTaken === true,
      } as const;
    },
  );
}

export async function applyTenantSkinAction(targetSlug: string, skinId: string): Promise<void> {
  await withTargetTenant(
    targetSlug,
    "platform.branding.applySkin",
    "tenant.branding.override",
    `Platform operator applied a skin to tenant "${targetSlug}".`,
    (principal) => manageAppearance().applyTenantSkin(skinId, principal.id, FALLBACK_LOCALE_DIRECTION),
  );
}

export async function duplicateTenantSkinAction(
  targetSlug: string,
  sourceSkinId: string,
  newName: string,
): Promise<void> {
  await withTargetTenant(
    targetSlug,
    "platform.branding.duplicateSkin",
    "tenant.branding.override",
    `Platform operator duplicated a skin for tenant "${targetSlug}".`,
    (principal) =>
      sourceSkinId === SYSTEM_DEFAULT_SKIN_ID
        ? manageAppearance().duplicateSystemDefaultSkin(newName, principal.id)
        : manageAppearance().duplicateTenantSkin(sourceSkinId, newName, principal.id),
  );
}

export async function renameTenantSkinAction(
  targetSlug: string,
  skinId: string,
  name: string,
  description: string | null,
): Promise<void> {
  await withTargetTenant(
    targetSlug,
    "platform.branding.renameSkin",
    "tenant.branding.override",
    `Platform operator renamed a skin for tenant "${targetSlug}".`,
    () => manageAppearance().renameTenantSkin(skinId, name, description),
  );
}

export async function deleteTenantSkinAction(
  targetSlug: string,
  skinId: string,
): Promise<SkinEditorDeletionResult> {
  return withTargetTenant(
    targetSlug,
    "platform.branding.deleteSkin",
    "tenant.branding.override",
    `Platform operator deleted a skin for tenant "${targetSlug}".`,
    () => manageAppearance().deleteTenantSkin(skinId),
  );
}

export async function exportTenantSkinAction(
  targetSlug: string,
  skinId: string,
  mode: "light" | "dark",
): Promise<string> {
  return withTargetTenant(
    targetSlug,
    "platform.branding.exportSkin",
    "tenant.branding.override",
    `Platform operator exported a skin from tenant "${targetSlug}".`,
    () => manageAppearance().buildSkinExportDocument(skinId, mode),
  );
}

export async function uploadBrandAssetAction(
  targetSlug: string,
  kind: BrandAssetKind,
  formData: FormData,
): Promise<
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly errorCode: UploadBrandAssetErrorCode }
> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, errorCode: "invalidType" };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());

  return withTargetTenant(
    targetSlug,
    "platform.branding.uploadAsset",
    "tenant.branding.override",
    `Platform operator uploaded a brand asset for tenant "${targetSlug}".`,
    async (principal) => {
      const result = await uploadBrandAsset().execute({
        kind,
        bytes,
        fileName: file.name,
        uploadedByStaffUserId: principal.id,
      });
      return result.ok
        ? ({ ok: true, url: result.url } as const)
        : ({ ok: false, errorCode: result.errorCode } as const);
    },
  );
}

/** Never rebound — the operator's own ambient tenant. See this file's own module comment. */
export async function applyPersonalSkinAction(skinId: string): Promise<void> {
  await withStaffAuth(async ({ principal }) => {
    await platformOperatorGate().execute(principal, "platform.branding (personal)");
    await manageAppearance().applyPersonalSkin(
      principal.id,
      skinId === SYSTEM_DEFAULT_SKIN_ID ? SYSTEM_DEFAULT_SKIN_ID : skinId,
    );
  });
}

/** Never rebound — the operator's own ambient tenant. See this file's own module comment. */
export async function savePersonalPreferenceAction(input: {
  readonly mode: "Light" | "Dark" | "System" | null;
  readonly density: "Compact" | "Comfortable" | null;
  readonly direction: "LTR" | "RTL" | null;
  readonly fontSize: string | null;
  readonly reducedMotion: boolean | null;
}): Promise<void> {
  await withStaffAuth(async ({ principal }) => {
    await platformOperatorGate().execute(principal, "platform.branding (personal)");
    await manageAppearance().savePersonalPreferenceScalars(principal.id, input);
  });
}

/** Pure parsing, no store access — gated for consistency with every other action on this screen. */
export async function importSkinModeAction(
  mode: "light" | "dark",
  fileText: string,
): Promise<SkinEditorImportResult> {
  return withStaffAuth(async ({ principal }) => {
    await platformOperatorGate().execute(principal, "platform.branding.import");
    const result = parseSkinDocument(fileText);
    if (!result.ok) return { ok: false, issues: result.issues } as const;
    const tokens: SemanticColorTokens = resolveSkinTokens(result.skin, mode);
    return { ok: true, tokens } as const;
  });
}

export async function listTenantsForBrandingAction(): Promise<
  ActionResult<readonly { readonly slug: string; readonly displayName: string; readonly status: string }[]>
> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      await platformOperatorGate().execute(principal, "platform.branding.listTenants");
      const tenants = await tenantRegistry().listAll();
      return {
        ok: true,
        value: tenants.map((t) => ({ slug: t.slug, displayName: t.displayName, status: t.status })),
      } as const;
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export type ActionResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export interface TenantBrandingData {
  readonly initialEditingSkinId: string | null;
  readonly initialSkinName: string;
  readonly initialSkinDescription: string | null;
  readonly initialLight: SemanticColorTokens;
  readonly initialDark: SemanticColorTokens;
  readonly initialBranding: {
    readonly appTitle: string;
    readonly defaultMode: "Light" | "Dark" | "System";
    readonly defaultDirection: "LTR" | "RTL";
    readonly density: "Compact" | "Comfortable";
    readonly fontSize: string;
    readonly shadowDepth: string;
    readonly sidebarStyle: string;
  };
  readonly initialBrandAssets: {
    readonly logoLightUrl: string | null;
    readonly logoDarkUrl: string | null;
    readonly faviconUrl: string | null;
  };
  readonly hasTenantBranding: boolean;
  readonly skins: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly isActive: boolean;
    readonly isSystem: boolean;
    readonly updatedAt: string | null;
  }[];
}

export async function loadTenantBrandingAction(
  targetSlug: string,
): Promise<ActionResult<TenantBrandingData>> {
  try {
    return await withTargetTenant(
      targetSlug,
      "platform.branding.load",
      "tenant.branding.view",
      `Platform operator viewed tenant "${targetSlug}"'s branding.`,
      async () => {
        const repo = themeRepository();

        const tenantBranding = await repo.readTenantBranding();
        const hasTenantBranding = tenantBranding !== null;
        const skins = await manageAppearance().listSkinsForManager(hasTenantBranding);

        const activeTenantSkin = skins.find((skin) => skin.isActive && !skin.isSystem) ?? null;
        const t = await getTranslations("platformAdmin.branding");

        const initialLight = tenantBranding?.activeSkinColors.light ?? resolveSkinTokens(systemSkin("light"), "light");
        const initialDark = tenantBranding?.activeSkinColors.dark ?? resolveSkinTokens(systemSkin("dark"), "dark");
        const systemFallback = systemFallbackAppearance(systemSkin("light"));

        const initialBranding: TenantBrandingData["initialBranding"] = tenantBranding
          ? {
              appTitle: tenantBranding.appTitle,
              defaultMode: tenantBranding.defaultMode,
              defaultDirection: tenantBranding.defaultDirection,
              density: tenantBranding.density,
              fontSize: tenantBranding.fontSize,
              shadowDepth: tenantBranding.shadowDepth,
              sidebarStyle: tenantBranding.sidebarStyle,
            }
          : {
              appTitle: systemFallback.appTitle,
              defaultMode: "System",
              defaultDirection: FALLBACK_LOCALE_DIRECTION,
              density: "Comfortable",
              fontSize: "0.875rem",
              shadowDepth: systemFallback.shadowDepth,
              sidebarStyle: systemFallback.sidebarStyle,
            };

        return {
          ok: true,
          value: {
            initialEditingSkinId: activeTenantSkin?.id ?? null,
            initialSkinName: activeTenantSkin?.name ?? t("defaultSkinName"),
            initialSkinDescription: activeTenantSkin?.description ?? null,
            initialLight,
            initialDark,
            initialBranding,
            initialBrandAssets: {
              logoLightUrl: tenantBranding?.logoLightUrl ?? null,
              logoDarkUrl: tenantBranding?.logoDarkUrl ?? null,
              faviconUrl: tenantBranding?.faviconUrl ?? null,
            },
            hasTenantBranding,
            skins,
          },
        } as const;
      },
    );
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
