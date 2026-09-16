"use client";

/**
 * `/branding` — the platform operator's cross-tenant branding screen (Part D + E).
 *
 * Reuses the real `SkinEditor` organism completely unchanged (Part D's own design):
 * this component's only job is a tenant picker plus binding every tenant-wide action
 * to whichever tenant is currently selected, via closures — `SkinEditor` itself
 * never knows it is being driven cross-tenant.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { InlineAlert } from "@/components/ui/inline-alert";
import { SkinEditor } from "@/components/patterns/skin-editor/skin-editor";
import type { TenantBrandingData } from "./actions.js";
import {
  applyPersonalSkinAction,
  applyTenantSkinAction,
  deleteTenantSkinAction,
  duplicateTenantSkinAction,
  exportTenantSkinAction,
  importSkinModeAction,
  loadTenantBrandingAction,
  renameTenantSkinAction,
  savePersonalPreferenceAction,
  saveTenantAppearanceAction,
  uploadBrandAssetAction,
} from "./actions.js";

export interface BrandingTenantOption {
  readonly slug: string;
  readonly displayName: string;
  readonly status: string;
}

export interface BrandingScreenProps {
  readonly locale: string;
  readonly tenants: readonly BrandingTenantOption[];
  readonly initialSlug: string;
  readonly initialData: TenantBrandingData;
}

const EMPTY_PERSONAL = {
  mode: null,
  density: null,
  direction: null,
  fontSize: null,
  reducedMotion: null,
} as const;

export function BrandingScreen({
  locale,
  tenants,
  initialSlug,
  initialData,
}: BrandingScreenProps): React.ReactElement {
  const t = useTranslations("platformAdmin.branding");
  const [selectedSlug, setSelectedSlug] = React.useState(initialSlug);
  const [data, setData] = React.useState<TenantBrandingData | null>(initialData);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSelectTenant(nextSlug: string): Promise<void> {
    setSelectedSlug(nextSlug);
    setLoading(true);
    setError(null);
    const result = await loadTenantBrandingAction(nextSlug);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      setData(null);
      return;
    }
    setData(result.value);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-foreground" htmlFor="platform-admin-tenant-picker">
          {t("tenantPickerLabel")}
        </label>
        <select
          id="platform-admin-tenant-picker"
          className="h-9 rounded-md border border-border-strong bg-transparent px-2 text-sm text-foreground"
          value={selectedSlug}
          onChange={(e) => void handleSelectTenant(e.target.value)}
        >
          {tenants.map((tenant) => (
            <option key={tenant.slug} value={tenant.slug}>
              {tenant.displayName} ({tenant.slug}) — {tenant.status}
            </option>
          ))}
        </select>
      </div>

      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
      {loading || !data ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}

      {!loading && data ? (
        <SkinEditor
          key={selectedSlug}
          canManageTenantAppearance
          resetHref={`/${locale}/branding/reset?tenant=${encodeURIComponent(selectedSlug)}`}
          initialEditingSkinId={data.initialEditingSkinId}
          initialSkinName={data.initialSkinName}
          initialSkinDescription={data.initialSkinDescription}
          initialLight={data.initialLight}
          initialDark={data.initialDark}
          initialBranding={data.initialBranding}
          initialBrandAssets={data.initialBrandAssets}
          hasTenantBranding={data.hasTenantBranding}
          initialPersonal={EMPTY_PERSONAL}
          skins={data.skins}
          actions={{
            saveTenantAppearance: (input) => saveTenantAppearanceAction(selectedSlug, input),
            applyTenantSkin: (skinId) => applyTenantSkinAction(selectedSlug, skinId),
            applyPersonalSkin: (skinId) => applyPersonalSkinAction(skinId),
            duplicateTenantSkin: (sourceSkinId, newName) =>
              duplicateTenantSkinAction(selectedSlug, sourceSkinId, newName),
            renameTenantSkin: (skinId, name, description) =>
              renameTenantSkinAction(selectedSlug, skinId, name, description),
            deleteTenantSkin: (skinId) => deleteTenantSkinAction(selectedSlug, skinId),
            exportTenantSkin: (skinId, mode) => exportTenantSkinAction(selectedSlug, skinId, mode),
            importSkinMode: (mode, fileText) => importSkinModeAction(mode, fileText),
            savePersonalPreference: (input) => savePersonalPreferenceAction(input),
            uploadBrandAsset: (kind, formData) => uploadBrandAssetAction(selectedSlug, kind, formData),
          }}
        />
      ) : null}
    </div>
  );
}
