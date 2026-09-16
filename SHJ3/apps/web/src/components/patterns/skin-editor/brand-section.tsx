"use client";

/**
 * §9.1's Brand section: "Primary, primary hover, secondary, accent + accent
 * foreground. Logo light, logo dark, logo mark, favicon (upload -> assetId). App
 * title. Sidebar style: neutral / brand / contrast. Sidebar width: 14 / 16 / 18rem."
 *
 * Renders the CURRENTLY-EDITED mode's five brand colours (the parent organism owns
 * which mode that is, and passes only that mode's tokens down — this component has
 * no light/dark concept of its own) plus the tenant-wide scalar fields: app title and
 * sidebar style, both real, persisted `TenantBranding` columns.
 *
 * ## Logo/favicon upload — real, as of this wave
 *
 * Closes the gap this file's own doc comment used to name plainly ("no `BrandAsset`-
 * writing adapter exists anywhere in this codebase"): `modules/theming`'s new
 * `UploadBrandAsset` use case, `BrandAssetStorage` port and `LocalBrandAssetStorage`
 * adapter are the real write path; `onUploadBrandAsset` (threaded from
 * `skin-editor.tsx`, which owns the immediate-commit semantics — see that file's own
 * doc comment on why uploads do not go through the candidate/Save flow) is the seam.
 * Three real controls: logo light, logo dark, favicon — `SkinEditorBrandAssetKind`
 * deliberately has no fourth "logo mark" member: no schema column exists for it
 * (`TenantBranding` only carries `logoLightAssetId`/`logoDarkAssetId`/
 * `faviconAssetId`), matching this file's own established "a control with no token/
 * column behind it is a control that lies" discipline — flagged in `tasks/todo.md`'s
 * review entry as a real, narrower scope than §9.1's literal four-item list, not a
 * silent omission.
 *
 * Upload is gated on `canUpload` (= `canManageTenantAppearance && hasTenantBranding`)
 * rather than attempted and shown a raw error: `saveBrandAsset`'s real NOT NULL
 * `TenantBranding.activeSkinId` foreign key means there is nothing to attach an asset
 * to until the tenant has saved an appearance at least once — an honest, translated
 * notice replaces the control in that state, the same "no lying control" discipline
 * `sidebarWidth`'s note below already follows.
 *
 * Sidebar width is a real §9.1 control with NO backing column today (`TenantBranding`
 * has no `sidebarWidth` — checked directly). Still rendered as an honest,
 * non-interactive, translated note rather than a control that would silently no-op on
 * Save. See `tasks/todo.md`'s review entry for the full reasoning.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import type { SemanticColorTokenName, SemanticColorTokens } from "@shj3/tokens";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ColorField } from "./color-field.js";
import type {
  SkinEditorBrandAssetKind,
  SkinEditorBrandAssets,
  SkinEditorBrandingScalars,
  SkinEditorUploadBrandAssetResult,
} from "./skin-editor-types.js";

export interface BrandSectionProps {
  readonly tokens: SemanticColorTokens;
  readonly onTokenChange: (key: SemanticColorTokenName, value: string) => void;
  readonly branding: SkinEditorBrandingScalars;
  readonly onBrandingChange: (patch: Partial<SkinEditorBrandingScalars>) => void;
  readonly disabled: boolean;
  readonly brandAssets: SkinEditorBrandAssets;
  readonly canUpload: boolean;
  readonly onUploadBrandAsset: (
    kind: SkinEditorBrandAssetKind,
    formData: FormData,
  ) => Promise<SkinEditorUploadBrandAssetResult>;
}

const SIDEBAR_STYLE_OPTIONS = [
  { value: "neutral", labelKey: "sidebarStyleNeutral" },
  { value: "brand", labelKey: "sidebarStyleBrand" },
  { value: "contrast", labelKey: "sidebarStyleContrast" },
] as const satisfies readonly { value: string; labelKey: string }[];

const BRAND_COLOR_FIELDS: readonly { key: SemanticColorTokenName; labelKey: string }[] = [
  { key: "primary", labelKey: "primary" },
  { key: "primaryHover", labelKey: "primaryHover" },
  { key: "secondary", labelKey: "secondary" },
  { key: "accent", labelKey: "accent" },
  { key: "accentForeground", labelKey: "accentForeground" },
];

export function BrandSection({
  tokens,
  onTokenChange,
  branding,
  onBrandingChange,
  disabled,
  brandAssets,
  canUpload,
  onUploadBrandAsset,
}: BrandSectionProps) {
  const t = useTranslations("skinEditor.brand");
  const tColorField = useTranslations("skinEditor.colorField");

  return (
    <div className="flex flex-col gap-6">
      <fieldset disabled={disabled} className="flex flex-col gap-4">
        <legend className="text-sm font-medium text-foreground">{t("heading")}</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {BRAND_COLOR_FIELDS.map(({ key, labelKey }) => (
            <ColorField
              key={key}
              id={`skin-editor-brand-${key}`}
              label={t(labelKey)}
              value={tokens[key]}
              onChange={(value) => onTokenChange(key, value)}
              invalidMessage={tColorField("invalidHex")}
            />
          ))}
        </div>

        <FormField label={t("appTitle")} id="skin-editor-app-title">
          {(field) => (
            <Input
              {...field}
              value={branding.appTitle}
              placeholder={t("appTitlePlaceholder")}
              onChange={(event) => onBrandingChange({ appTitle: event.target.value })}
            />
          )}
        </FormField>

        <div className="flex flex-col gap-2">
          <Label htmlFor="skin-editor-sidebar-style">{t("sidebarStyle")}</Label>
          <RadioGroup
            id="skin-editor-sidebar-style"
            value={branding.sidebarStyle}
            onValueChange={(value) => onBrandingChange({ sidebarStyle: value })}
            className="flex flex-col gap-2"
          >
            {SIDEBAR_STYLE_OPTIONS.map(({ value, labelKey }) => (
              <div key={value} className="flex items-center gap-2">
                <RadioGroupItem value={value} id={`skin-editor-sidebar-style-${value}`} />
                <Label htmlFor={`skin-editor-sidebar-style-${value}`} variant="default">
                  {t(labelKey)}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      </fieldset>

      <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-surface-sunken p-4">
        <span className="text-sm font-medium text-muted-foreground">{t("sidebarWidth")}</span>
        <p className="text-xs text-muted-foreground">{t("notYetCustomisable")}</p>
      </div>

      <div className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-border p-4">
        <span className="text-sm font-medium text-foreground">{t("logosHeading")}</span>
        {!canUpload ? (
          <p className="text-xs text-muted-foreground">{t("uploadNeedsTenantBranding")}</p>
        ) : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <BrandAssetUploadField
            kind="LogoLight"
            label={t("logoLight")}
            currentUrl={brandAssets.logoLightUrl}
            previewAlt={t("logoLightPreviewAlt")}
            disabled={!canUpload}
            onUpload={onUploadBrandAsset}
          />
          <BrandAssetUploadField
            kind="LogoDark"
            label={t("logoDark")}
            currentUrl={brandAssets.logoDarkUrl}
            previewAlt={t("logoDarkPreviewAlt")}
            disabled={!canUpload}
            onUpload={onUploadBrandAsset}
          />
          <BrandAssetUploadField
            kind="Favicon"
            label={t("favicon")}
            currentUrl={brandAssets.faviconUrl}
            previewAlt={t("faviconPreviewAlt")}
            disabled={!canUpload}
            onUpload={onUploadBrandAsset}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * One upload control — a real, immediately-committing file input (see this file's
 * own doc comment for why logos/favicon do not go through the candidate/Save flow),
 * a live preview of whatever is currently active, and a real, server-surfaced error
 * on the two genuinely-rejectable cases (`invalidType`, `tooLarge` — `accept="image/
 * png,image/webp,image/x-icon"` narrows the file picker for convenience only; the
 * real rejection is server-side, in `UploadBrandAsset`, per this project's own
 * "never trust a client-side filter alone" security discipline).
 */
function BrandAssetUploadField({
  kind,
  label,
  currentUrl,
  previewAlt,
  disabled,
  onUpload,
}: {
  readonly kind: SkinEditorBrandAssetKind;
  readonly label: string;
  readonly currentUrl: string | null;
  readonly previewAlt: string;
  readonly disabled: boolean;
  readonly onUpload: (
    kind: SkinEditorBrandAssetKind,
    formData: FormData,
  ) => Promise<SkinEditorUploadBrandAssetResult>;
}) {
  const t = useTranslations("skinEditor.brand");
  const inputId = `skin-editor-brand-asset-${kind}`;
  const [uploading, setUploading] = React.useState(false);
  const [errorCode, setErrorCode] = React.useState<
    "invalidType" | "tooLarge" | "noTenantBranding" | null
  >(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    // Always clear the input's own value, success or failure — otherwise
    // re-selecting the identical file (a genuine retry after fixing the file
    // outside the browser) would not fire another `change` event at all.
    event.target.value = "";
    if (!file) return;

    setErrorCode(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await onUpload(kind, formData);
      if (!result.ok) setErrorCode(result.errorCode);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId}>{label}</Label>
      <div
        className="flex items-center justify-center rounded-[var(--radius-md)] border border-dashed border-border bg-surface-sunken"
        style={{ blockSize: "var(--space-16)" }}
      >
        {currentUrl ? (
          // A plain <img>, not next/image: a tenant-uploaded asset served from
          // local disk (LocalBrandAssetStorage) has no build-time-known dimensions
          // or remote-pattern config for next/image's optimiser to target, and
          // this repo's own eslint config does not load the @next/next plugin
          // that would otherwise flag this (confirmed by reading eslint.config.mjs
          // directly).
          <img src={currentUrl} alt={previewAlt} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-xs text-muted-foreground">{t("noUploadYet")}</span>
        )}
      </div>
      <input
        id={inputId}
        type="file"
        accept="image/png,image/webp,image/x-icon"
        disabled={disabled || uploading}
        onChange={(event) => void handleFileChange(event)}
        className="text-xs text-foreground"
      />
      {uploading ? <p className="text-xs text-muted-foreground">{t("uploading")}</p> : null}
      {errorCode ? (
        <InlineAlert variant="destructive">{t(`uploadError.${errorCode}`)}</InlineAlert>
      ) : null}
    </div>
  );
}
