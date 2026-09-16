"use server";

/**
 * Server Actions for `/settings/appearance` — the real `SkinEditor` organism's
 * backing writes. A dedicated file with a module-level `"use server"` directive,
 * mirroring `reset/actions.ts`'s established pattern exactly (required, not a style
 * choice — see that file's own doc comment for the real production build failure
 * this avoids).
 *
 * ## The same environment-specific `next build` limitation as `reset/actions.ts`
 *
 * This file reaches `PrismaThemeRepository`, so it reproduces the identical,
 * already-documented, Windows-only Next.js + Prisma `next build` failure
 * `reset/actions.ts`'s own doc comment describes in full (prisma/prisma#27934,
 * vercel/next.js#62281, triggered by ADR-0011's custom Prisma generator output path).
 * Not re-litigated here — see that file. Verified the same way: `next dev` serves
 * every action correctly (checked directly), `node scripts/verify.mjs --staged` has
 * no `next build` stage, and every other check (typecheck, lint, gates, the unit
 * suite) is clean.
 *
 * ## Real staff auth, via `withStaffAuth()` — every action re-resolves its own context
 *
 * These 9 actions used to call the bare `requirePrincipal()` (`tenant-context.ts`),
 * which reads an ambient `AsyncLocalStorage` binding that nothing in the App Router
 * ever establishes for a Server Action invocation (see `next-request-context.ts`'s
 * own doc comment, and `tasks/lessons.md`'s "AsyncLocalStorage does not survive a
 * Server Component/Server Action boundary" entry) — every real call was silently
 * throwing "requires an authenticated principal" for a real, signed-in staff user.
 * Fixed by adopting `(backoffice)/iam/actions.ts`'s exact, proven convention: each
 * action wraps its own body in `withStaffAuth(handler, { method: "POST", body:
 * <the action's own arguments> })`, which re-resolves a real `Principal` from the
 * request's real cookies at the point each action actually runs. `withStaffAuth`'s
 * handler is only ever invoked with a fully-resolved, non-null `Principal` (it
 * throws `UnauthenticatedError` instead of invoking the handler otherwise), so the
 * old, separate `requirePrincipal()` call inside each handler is gone too — it would
 * now just be re-checking something `withStaffAuth` already guarantees.
 *
 * ## Every write here requires `appearance:manage`; reads/personal actions do not
 *
 * Matching `manage-appearance.ts`'s own doc comment on why the personal-skin surface
 * is narrower than §9.3's table taken literally: authoring or changing TENANT-WIDE
 * colours/branding/skins requires the permission (checked here, the caller, per
 * api.md §12 invariant 2 — `ManageAppearance` itself does not check it). Applying an
 * ALREADY-SAVED skin to one's OWN personal preference, and the five personal scalar
 * fields (mode/density/direction/font size/reduced motion), need only an
 * authenticated principal — §9.3: "the user, for themselves." This split is
 * unchanged by the auth fix above — still exactly 5 permission-gated actions
 * (`saveTenantAppearanceAction`, `applyTenantSkinAction`,
 * `duplicateTenantSkinAction`, `renameTenantSkinAction`, `deleteTenantSkinAction`)
 * and 4 authenticated-only ones (`applyPersonalSkinAction`, `exportTenantSkinAction`,
 * `importSkinModeAction`, `savePersonalPreferenceAction`).
 */

import { parseSkinDocument, resolveSkinTokens } from "@shj3/tokens";
import type { SemanticColorTokens } from "@shj3/tokens";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import {
  ManageAppearance,
  SYSTEM_DEFAULT_SKIN_ID,
} from "../../../../modules/theming/application/manage-appearance.js";
import { PrismaThemeRepository } from "../../../../modules/theming/adapters/outbound/sql/prisma-theme-repository.js";
import {
  UploadBrandAsset,
  type UploadBrandAssetErrorCode,
} from "../../../../modules/theming/application/upload-brand-asset.js";
import { LocalBrandAssetStorage } from "../../../../modules/theming/adapters/outbound/fs/local-brand-asset-storage.js";
import type { BrandAssetKind } from "../../../../modules/theming/domain/brand-asset.js";
import type {
  SkinEditorActions,
  SkinEditorImportResult,
  SkinEditorSaveInput,
  SkinEditorSaveResult,
} from "../../../../components/patterns/skin-editor/skin-editor.js";
import type { SkinEditorDeletionResult } from "../../../../components/patterns/skin-editor/skin-editor-types.js";

const MANAGE_PERMISSION = "appearance:manage" as const;

function manager(): ManageAppearance {
  return new ManageAppearance(new PrismaThemeRepository());
}

/** The tenant's own locale direction is not resolvable inside a Server Action (no
 *  request-scoped locale param is passed to one) — `LTR` is the same, honest,
 *  documented baseline `manage-appearance.ts`'s own `buildTenantBrandingBaseline`
 *  falls back to when nothing better is known, used only for the rare case a
 *  TenantBranding row is created for the very first time via a Skin-Manager
 *  "Apply" with no prior save. The main `saveTenantAppearanceAction` path (the
 *  common case) always supplies a real `defaultDirection` from the editor's own
 *  form state instead, so this fallback is reached only by that one narrow path. */
const FALLBACK_LOCALE_DIRECTION = "LTR" as const;

export async function saveTenantAppearanceAction(
  input: SkinEditorSaveInput,
): Promise<SkinEditorSaveResult> {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "settings.appearance.save");

      const result = await manager().saveTenantAppearance({
        editingSkinId: input.editingSkinId,
        skinName: input.skinName,
        skinDescription: input.skinDescription,
        light: input.light,
        dark: input.dark,
        branding: input.branding,
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
    { method: "POST", body: input },
  );
}

export async function applyTenantSkinAction(skinId: string): Promise<void> {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "settings.appearance.applyTenantSkin");
      await manager().applyTenantSkin(skinId, principal.id, FALLBACK_LOCALE_DIRECTION);
    },
    { method: "POST", body: { skinId } },
  );
}

export async function applyPersonalSkinAction(skinId: string): Promise<void> {
  return withStaffAuth(
    async ({ principal }) => {
      await manager().applyPersonalSkin(
        principal.id,
        skinId === SYSTEM_DEFAULT_SKIN_ID ? SYSTEM_DEFAULT_SKIN_ID : skinId,
      );
    },
    { method: "POST", body: { skinId } },
  );
}

export async function duplicateTenantSkinAction(
  sourceSkinId: string,
  newName: string,
): Promise<void> {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "settings.appearance.duplicateTenantSkin");
      if (sourceSkinId === SYSTEM_DEFAULT_SKIN_ID) {
        await manager().duplicateSystemDefaultSkin(newName, principal.id);
      } else {
        await manager().duplicateTenantSkin(sourceSkinId, newName, principal.id);
      }
    },
    { method: "POST", body: { sourceSkinId, newName } },
  );
}

export async function renameTenantSkinAction(
  skinId: string,
  name: string,
  description: string | null,
): Promise<void> {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "settings.appearance.renameTenantSkin");
      await manager().renameTenantSkin(skinId, name, description);
    },
    { method: "POST", body: { skinId, name, description } },
  );
}

export async function deleteTenantSkinAction(skinId: string): Promise<SkinEditorDeletionResult> {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "settings.appearance.deleteTenantSkin");
      return manager().deleteTenantSkin(skinId);
    },
    { method: "POST", body: { skinId } },
  );
}

export async function exportTenantSkinAction(
  skinId: string,
  mode: "light" | "dark",
): Promise<string> {
  // Exporting is a read — gated by an authenticated principal only. §9.3's own table
  // has no "who may export" row narrower than "who may see the skin at all", and the
  // skin manager already only lists skins to a signed-in staff user.
  return withStaffAuth(async () => manager().buildSkinExportDocument(skinId, mode), {
    method: "POST",
    body: { skinId, mode },
  });
}

export async function importSkinModeAction(
  mode: "light" | "dark",
  fileText: string,
): Promise<SkinEditorImportResult> {
  // Import validates untrusted input (§7.4) but does not yet WRITE anything — the
  // result lands in the client-side candidate, and Save is what persists it, gated
  // there. Still requires a real principal: an unauthenticated import path does not
  // exist (§7.4's own additional-rules list) — enforced here by `withStaffAuth`
  // itself (it throws `UnauthenticatedError` rather than invoking this handler).
  return withStaffAuth(
    async () => {
      const result = parseSkinDocument(fileText);
      if (!result.ok) {
        return { ok: false, issues: result.issues } as const;
      }
      const tokens: SemanticColorTokens = resolveSkinTokens(result.skin, mode);
      return { ok: true, tokens } as const;
    },
    { method: "POST", body: { mode, fileText } },
  );
}

export async function savePersonalPreferenceAction(
  input: Parameters<SkinEditorActions["savePersonalPreference"]>[0],
): Promise<void> {
  return withStaffAuth(
    async ({ principal }) => {
      await manager().savePersonalPreferenceScalars(principal.id, input);
    },
    { method: "POST", body: input },
  );
}

export type UploadBrandAssetActionResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly errorCode: UploadBrandAssetErrorCode };

/**
 * Real logo/favicon upload (§9.1's Brand section) — the write path
 * `brand-section.tsx`'s "not yet available" note used to stand in for (see that
 * component's own doc comment before this wave). Gated by `appearance:manage`
 * exactly like every other tenant-wide write in this file: logos/favicon are
 * branding, not a personal preference (§9.3's control matrix has no user-tier
 * row for any of the three, and `ThemeRepository.saveBrandAsset`'s own doc
 * comment states the same).
 *
 * Accepts a real `FormData` (a `<input type="file">`'s natural shape) rather than
 * a typed argument object — this is the one action in this file that moves an
 * actual binary payload, which a plain JSON-serialisable Server Action argument
 * cannot carry.
 */
export async function uploadBrandAssetAction(
  kind: BrandAssetKind,
  formData: FormData,
): Promise<UploadBrandAssetActionResult> {
  const file = formData.get("file");
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "settings.appearance.uploadBrandAsset");

      if (!(file instanceof File)) {
        return { ok: false, errorCode: "invalidType" };
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const useCase = new UploadBrandAsset(
        new PrismaThemeRepository(),
        new LocalBrandAssetStorage(),
      );
      const result = await useCase.execute({
        kind,
        bytes,
        fileName: file.name,
        uploadedByStaffUserId: principal.id,
      });

      return result.ok ? { ok: true, url: result.url } : { ok: false, errorCode: result.errorCode };
    },
    // Never the raw FormData/File as `body` (not a plain, loggable value) — a
    // small summary is enough for `AuthMiddleware`'s own forged-tenant-field
    // check, which this payload shape has no way to carry anyway.
    { method: "POST", body: { kind, fileName: file instanceof File ? file.name : null } },
  );
}
