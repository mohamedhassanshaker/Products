import { getTranslations } from "next-intl/server";
import { resolveSkinTokens, systemSkin, type SemanticColorTokens } from "@shj3/tokens";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import { PermissionDeniedError } from "../../../../modules/iam/domain/permissions.js";
import { ManageAppearance } from "../../../../modules/theming/application/manage-appearance.js";
import { PrismaThemeRepository } from "../../../../modules/theming/adapters/outbound/sql/prisma-theme-repository.js";
import { systemFallbackAppearance } from "../../../../modules/theming/domain/theme.js";
import { dbDirectionForLocale, type AppLocale } from "../../../../i18n/locale-direction.js";
import { SkinEditor } from "../../../../components/patterns/skin-editor/skin-editor.js";
import type {
  SkinEditorBrandAssets,
  SkinEditorBrandingScalars,
  SkinEditorPersonalPreference,
  SkinEditorSkinEntry,
} from "../../../../components/patterns/skin-editor/skin-editor-types.js";
import {
  applyPersonalSkinAction,
  applyTenantSkinAction,
  deleteTenantSkinAction,
  duplicateTenantSkinAction,
  exportTenantSkinAction,
  importSkinModeAction,
  renameTenantSkinAction,
  savePersonalPreferenceAction,
  saveTenantAppearanceAction,
  uploadBrandAssetAction,
} from "./actions.js";

type PageData =
  | { readonly kind: "unauthenticated" }
  | {
      readonly kind: "ok";
      readonly canManageTenantAppearance: boolean;
      readonly initialEditingSkinId: string | null;
      readonly initialSkinName: string;
      readonly initialSkinDescription: string | null;
      readonly initialLight: SemanticColorTokens;
      readonly initialDark: SemanticColorTokens;
      readonly initialBranding: SkinEditorBrandingScalars;
      readonly initialBrandAssets: SkinEditorBrandAssets;
      readonly hasTenantBranding: boolean;
      readonly initialPersonal: SkinEditorPersonalPreference;
      readonly skins: readonly SkinEditorSkinEntry[];
    };

/**
 * `/settings/appearance` — design-system.md §9, the real Settings -> Appearance
 * screen the `SkinEditor` organism lives on (§5.5 #55). Sibling to the already-built
 * `reset/` subroute, untouched by this file.
 *
 * ## Real staff auth, via B-2's proven `withStaffAuth()` — not the placeholder this
 * ## page rendered before
 *
 * This page used to call the bare `tryGetTenantContext()` directly, which — per
 * `next-request-context.ts`'s own doc comment and `tasks/lessons.md`'s "AsyncLocal
 * Storage does not survive a Server Component/Server Action boundary" entry — never
 * resolves a real context in the App Router: nothing binds one ambiently, so every
 * real request fell through to a placeholder "no tenant context yet" state even once
 * real sessions existed. Fixed by adopting `(backoffice)/iam/page.tsx`'s exact,
 * proven pattern: `withStaffAuth()` re-resolves a real `AuthenticatedRequestContext`
 * at this page's own entry point, same as every other real staff route now does.
 *
 * ## Why this collapsed from a three-way fallback to two (unauthenticated / ok)
 *
 * The old code branched on `!context` (generic placeholder) and, separately,
 * `!principal` (sign-in prompt) — but `AuthMiddleware.handle()` (which
 * `withStaffAuth()` drives) has no code path on the staff route that yields a
 * resolved context with a null principal: it either throws `UnauthenticatedError`
 * (no cookie, an absent session, or a revoked one) or succeeds with a fully resolved
 * `Principal` (`handleAnonymous`, the only path that tolerates a null principal, is
 * citizen-surface only — never called here). So the old two-tier "no context" vs "no
 * principal" split never corresponded to two different real states; it collapses
 * into the same `unauthenticated`/`ok` split `iam/page.tsx` already uses. What does
 * NOT collapse is the view-only vs. full-access split *within* `ok`:
 * `canManageTenantAppearance` still gates tenant-wide editing while letting any
 * authenticated principal manage their own personal preferences (§9.3), which is a
 * real, load-bearing distinction this page's own permission model makes on purpose
 * — unlike `iam/page.tsx`, this screen never fully blocks an authenticated principal.
 *
 * ## The `reset/` sibling shares this exact bug, and is deliberately not fixed here
 *
 * `reset/page.tsx` and `reset/actions.ts` also call bare `tryGetTenantContext()` —
 * confirmed by reading both directly. That is genuinely the same defect (a real
 * signed-in Entity Admin/Super Admin hitting `/settings/appearance/reset` today also
 * sees no principal, so both of that route's real mutations are currently
 * unreachable for a real session), not a different, deliberately-anonymous design —
 * the route's own "escape hatch" doc comment is about being legible independent of a
 * possibly-broken tenant *theme* (literal inline styles, not CSS custom properties),
 * never about working without real authentication. Left exactly as it is: out of
 * scope for this fix, named here rather than silently left for the next person to
 * rediscover.
 */
export default async function AppearancePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("settingsAppearance");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      let canManageTenantAppearance = false;
      try {
        requirePermission(principal, "appearance:manage", "settings.appearance (visibility)");
        canManageTenantAppearance = true;
      } catch (error) {
        if (!(error instanceof PermissionDeniedError)) throw error;
      }

      const repo = new PrismaThemeRepository();
      const manage = new ManageAppearance(repo);

      const [tenantBranding, userPreference] = await Promise.all([
        repo.readTenantBranding(),
        repo.readUserPreference(principal.id),
      ]);
      const hasTenantBranding = tenantBranding !== null;
      const skins: readonly SkinEditorSkinEntry[] =
        await manage.listSkinsForManager(hasTenantBranding);

      const activeTenantSkin = skins.find((skin) => skin.isActive && !skin.isSystem) ?? null;

      const initialLight: SemanticColorTokens =
        tenantBranding?.activeSkinColors.light ?? resolveSkinTokens(systemSkin("light"), "light");
      const initialDark: SemanticColorTokens =
        tenantBranding?.activeSkinColors.dark ?? resolveSkinTokens(systemSkin("dark"), "dark");

      const localeDirection = dbDirectionForLocale(locale as AppLocale);
      const systemFallback = systemFallbackAppearance(systemSkin("light"));
      const initialBranding: SkinEditorBrandingScalars = tenantBranding
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
            defaultDirection: localeDirection,
            density: "Comfortable",
            fontSize: "0.875rem",
            shadowDepth: systemFallback.shadowDepth,
            sidebarStyle: systemFallback.sidebarStyle,
          };

      const initialPersonal: SkinEditorPersonalPreference = userPreference
        ? {
            mode: userPreference.mode,
            density: userPreference.density,
            direction: userPreference.direction,
            fontSize: userPreference.fontSize,
            reducedMotion: userPreference.reducedMotion,
          }
        : { mode: null, density: null, direction: null, fontSize: null, reducedMotion: null };

      const initialBrandAssets: SkinEditorBrandAssets = {
        logoLightUrl: tenantBranding?.logoLightUrl ?? null,
        logoDarkUrl: tenantBranding?.logoDarkUrl ?? null,
        faviconUrl: tenantBranding?.faviconUrl ?? null,
      };

      return {
        kind: "ok",
        canManageTenantAppearance,
        initialEditingSkinId: activeTenantSkin?.id ?? null,
        initialSkinName: activeTenantSkin?.name ?? t("defaultSkinName"),
        initialSkinDescription: activeTenantSkin?.description ?? null,
        initialLight,
        initialDark,
        initialBranding,
        initialBrandAssets,
        hasTenantBranding,
        initialPersonal,
        skins,
      } as const;
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      pageData = { kind: "unauthenticated" };
    } else {
      throw error;
    }
  }

  if (pageData.kind === "unauthenticated") {
    const tCommon = await getTranslations("common");
    return (
      <main className="flex flex-col gap-4 p-6">
        <SignInPrompt
          heading={t("pageTitle")}
          message={t("signInPrompt")}
          signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/settings/appearance`)}`}
          signInLabel={tCommon("signInCta")}
        />
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-4 p-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-foreground">{t("pageTitle")}</h1>
        {!pageData.canManageTenantAppearance ? (
          <p className="text-xs text-muted-foreground">{t("viewOnlyNotice")}</p>
        ) : null}
      </div>

      <SkinEditor
        canManageTenantAppearance={pageData.canManageTenantAppearance}
        resetHref={`/${locale}/settings/appearance/reset`}
        initialEditingSkinId={pageData.initialEditingSkinId}
        initialSkinName={pageData.initialSkinName}
        initialSkinDescription={pageData.initialSkinDescription}
        initialLight={pageData.initialLight}
        initialDark={pageData.initialDark}
        initialBranding={pageData.initialBranding}
        initialBrandAssets={pageData.initialBrandAssets}
        hasTenantBranding={pageData.hasTenantBranding}
        initialPersonal={pageData.initialPersonal}
        skins={pageData.skins}
        actions={{
          saveTenantAppearance: saveTenantAppearanceAction,
          applyTenantSkin: applyTenantSkinAction,
          applyPersonalSkin: applyPersonalSkinAction,
          duplicateTenantSkin: duplicateTenantSkinAction,
          renameTenantSkin: renameTenantSkinAction,
          deleteTenantSkin: deleteTenantSkinAction,
          exportTenantSkin: exportTenantSkinAction,
          importSkinMode: importSkinModeAction,
          savePersonalPreference: savePersonalPreferenceAction,
          uploadBrandAsset: uploadBrandAssetAction,
        }}
      />
    </main>
  );
}
