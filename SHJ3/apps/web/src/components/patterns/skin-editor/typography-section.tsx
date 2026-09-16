"use client";

/**
 * §9.1's Typography section: "Font family (sans / mono / Arabic, from the
 * allowlisted stacks), base size (13/14/15/16px), scale ratio (1.1-1.333 slider),
 * base weight (400/500)."
 *
 * Only base size is backed by a real column (`TenantBranding.fontSize` /
 * `UserThemePreference.fontSize`) — font family, scale ratio and base weight have no
 * column anywhere in this schema today (checked directly: neither `TenantBranding`
 * nor `TokenSet` nor `Skin` carries them), because — per the `TenantBranding` Prisma
 * model's own comment — "the shipped skins' typography and geometry are otherwise
 * identical and are served from `@shj3/tokens`' static exports rather than
 * round-tripped through a row." Rendered as honest, non-interactive, translated notes
 * rather than controls that would silently no-op on Save.
 */

import { useTranslations } from "next-intl";
import { SKIN_EDITOR_FONT_SIZES, type SkinEditorFontSize } from "./skin-editor-types.js";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export interface TypographySectionProps {
  readonly fontSize: string;
  readonly onFontSizeChange: (value: SkinEditorFontSize) => void;
  readonly disabled: boolean;
}

export function TypographySection({
  fontSize,
  onFontSizeChange,
  disabled,
}: TypographySectionProps) {
  const t = useTranslations("skinEditor.typography");

  return (
    <div className="flex flex-col gap-6">
      <fieldset disabled={disabled} className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground">{t("heading")}</legend>
        <Label htmlFor="skin-editor-font-size">{t("baseSize")}</Label>
        <RadioGroup
          id="skin-editor-font-size"
          value={fontSize}
          onValueChange={(value) => onFontSizeChange(value as SkinEditorFontSize)}
          className="flex flex-row flex-wrap gap-3"
        >
          {SKIN_EDITOR_FONT_SIZES.map((size) => (
            <div key={size} className="flex items-center gap-2">
              <RadioGroupItem value={size} id={`skin-editor-font-size-${size}`} />
              <Label htmlFor={`skin-editor-font-size-${size}`} className="font-mono" dir="ltr">
                {size}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>

      <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-surface-sunken p-4">
        <span className="text-sm font-medium text-muted-foreground">{t("fontFamily")}</span>
        <span className="text-sm font-medium text-muted-foreground">{t("scaleRatio")}</span>
        <span className="text-sm font-medium text-muted-foreground">{t("baseWeight")}</span>
        <p className="text-xs text-muted-foreground">{t("notYetCustomisable")}</p>
      </div>
    </div>
  );
}
