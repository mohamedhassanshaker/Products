"use client";

/**
 * §9.1's Layout section: "Corner radius (4-stop slider...). Density (compact /
 * comfortable). Shadow depth (4-stop...). Focus ring width and offset."
 *
 * Density and shadow depth are real, persisted `TenantBranding` columns. Corner
 * radius and focus ring width/offset have no column anywhere in this schema today —
 * same reasoning as `typography-section.tsx`'s own doc comment — rendered as honest,
 * non-interactive, translated notes.
 *
 * Shadow depth is a `Slider` over `SHADOW_DEPTH_STOPS`' four INDEXES (`@shj3/tokens`:
 * `[0, 0.5, 1, 1.6]`), not the raw multiplier values — `Slider`'s `formatValue` needs
 * a human label ("Flat"/"Subtle"/"Default"/"Pronounced") at each stop, which is
 * naturally an index-to-label lookup rather than a formatter over 0.5-spaced floats.
 */

import { useTranslations } from "next-intl";
import { SHADOW_DEPTH_STOPS } from "@shj3/tokens";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import type { SkinEditorDensity } from "./skin-editor-types.js";

export interface LayoutSectionProps {
  readonly density: SkinEditorDensity;
  readonly onDensityChange: (value: SkinEditorDensity) => void;
  readonly shadowDepth: string;
  readonly onShadowDepthChange: (value: string) => void;
  readonly disabled: boolean;
}

const SHADOW_DEPTH_LABEL_KEYS = [
  "shadowDepthFlat",
  "shadowDepthSubtle",
  "shadowDepthDefault",
  "shadowDepthPronounced",
] as const;

export function LayoutSection({
  density,
  onDensityChange,
  shadowDepth,
  onShadowDepthChange,
  disabled,
}: LayoutSectionProps) {
  const t = useTranslations("skinEditor.layout");
  const currentStopIndex = Math.max(
    0,
    SHADOW_DEPTH_STOPS.findIndex((v) => String(v) === shadowDepth),
  );

  return (
    <div className="flex flex-col gap-6">
      <fieldset disabled={disabled} className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground">{t("heading")}</legend>
        <Label htmlFor="skin-editor-density">{t("density")}</Label>
        <RadioGroup
          id="skin-editor-density"
          value={density}
          onValueChange={(value) => onDensityChange(value as SkinEditorDensity)}
          className="flex flex-row gap-3"
        >
          {(["Comfortable", "Compact"] as const).map((value) => (
            <div key={value} className="flex items-center gap-2">
              <RadioGroupItem value={value} id={`skin-editor-density-${value}`} />
              <Label htmlFor={`skin-editor-density-${value}`}>
                {t(value === "Compact" ? "densityCompact" : "densityComfortable")}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>

      <fieldset disabled={disabled} className="flex flex-col gap-2">
        <Slider
          aria-label={t("shadowDepth")}
          variant="stepped"
          min={0}
          max={SHADOW_DEPTH_STOPS.length - 1}
          step={1}
          value={currentStopIndex}
          onValueChange={(index) => onShadowDepthChange(String(SHADOW_DEPTH_STOPS[index]))}
          formatValue={(index) => t(SHADOW_DEPTH_LABEL_KEYS[index] ?? SHADOW_DEPTH_LABEL_KEYS[0])}
        />
      </fieldset>

      <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-surface-sunken p-4">
        <span className="text-sm font-medium text-muted-foreground">{t("cornerRadius")}</span>
        <span className="text-sm font-medium text-muted-foreground">{t("focusRing")}</span>
        <p className="text-xs text-muted-foreground">{t("notYetCustomisable")}</p>
      </div>
    </div>
  );
}
