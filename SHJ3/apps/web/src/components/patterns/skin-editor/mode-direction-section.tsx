"use client";

/**
 * §9.1's Mode & direction section (minus the Skin manager sub-block, which
 * `skin-manager.tsx` renders as a sibling in the same panel — see `skin-editor.tsx`):
 * "Light / Dark / System. Direction: follow locale (default) / force LTR / force RTL."
 *
 * Two independently-scoped groups, matching §9.3's control matrix exactly:
 *  - **Organisation default** — gated by `disabled` (mirrors `appearance:manage`).
 *    Direction here offers only Force LTR / Force RTL, never "follow locale": the
 *    real `TenantBranding.defaultDirection` column is `NOT NULL` (`"LTR"`/`"RTL"`
 *    only), so once ANY `TenantBranding` row exists it must commit to a concrete
 *    direction — there is no persisted "follow locale" tenant default to offer. This
 *    is a genuine, pre-existing schema constraint, not a UI simplification (see
 *    `TenantBrandingScalars`'s own doc comment in `ports/theme-repository.ts`).
 *  - **My personal preference** — never gated; any authenticated user may always set
 *    these for themselves (§9.3: "the user, for themselves"). Direction and mode both
 *    offer a genuine null/"follow organisation" state here, because
 *    `UserThemePreference`'s columns are actually nullable. Reduced motion has NO
 *    organisation-level counterpart at all (§9.3's table has no tenant row for it) —
 *    "an organisation can never force motion on you."
 */

import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import type { SkinEditorDirection, SkinEditorMode } from "./skin-editor-types.js";

export interface ModeDirectionSectionProps {
  readonly tenantMode: SkinEditorMode;
  readonly onTenantModeChange: (value: SkinEditorMode) => void;
  readonly tenantDirection: SkinEditorDirection;
  readonly onTenantDirectionChange: (value: SkinEditorDirection) => void;
  readonly tenantDisabled: boolean;

  readonly personalMode: SkinEditorMode | null;
  readonly onPersonalModeChange: (value: SkinEditorMode | null) => void;
  readonly personalDirection: SkinEditorDirection | null;
  readonly onPersonalDirectionChange: (value: SkinEditorDirection | null) => void;
  readonly personalReducedMotion: boolean;
  readonly onPersonalReducedMotionChange: (value: boolean) => void;
}

const FOLLOW = "__follow__";

export function ModeDirectionSection({
  tenantMode,
  onTenantModeChange,
  tenantDirection,
  onTenantDirectionChange,
  tenantDisabled,
  personalMode,
  onPersonalModeChange,
  personalDirection,
  onPersonalDirectionChange,
  personalReducedMotion,
  onPersonalReducedMotionChange,
}: ModeDirectionSectionProps) {
  const t = useTranslations("skinEditor.modeDirection");

  return (
    <div className="flex flex-col gap-8">
      <fieldset disabled={tenantDisabled} className="flex flex-col gap-4">
        <legend className="text-sm font-medium text-foreground">{t("tenantHeading")}</legend>

        <div className="flex flex-col gap-2">
          <Label htmlFor="skin-editor-tenant-mode">{t("mode")}</Label>
          <RadioGroup
            id="skin-editor-tenant-mode"
            value={tenantMode}
            onValueChange={(value) => onTenantModeChange(value as SkinEditorMode)}
            className="flex flex-row flex-wrap gap-3"
          >
            {(["Light", "Dark", "System"] as const).map((mode) => (
              <div key={mode} className="flex items-center gap-2">
                <RadioGroupItem value={mode} id={`skin-editor-tenant-mode-${mode}`} />
                <Label htmlFor={`skin-editor-tenant-mode-${mode}`}>
                  {t(`mode${mode}` as "modeLight" | "modeDark" | "modeSystem")}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="skin-editor-tenant-direction">{t("direction")}</Label>
          <RadioGroup
            id="skin-editor-tenant-direction"
            value={tenantDirection}
            onValueChange={(value) => onTenantDirectionChange(value as SkinEditorDirection)}
            className="flex flex-row flex-wrap gap-3"
          >
            {(["LTR", "RTL"] as const).map((direction) => (
              <div key={direction} className="flex items-center gap-2">
                <RadioGroupItem
                  value={direction}
                  id={`skin-editor-tenant-direction-${direction}`}
                />
                <Label htmlFor={`skin-editor-tenant-direction-${direction}`}>
                  {t(direction === "LTR" ? "directionForceLtr" : "directionForceRtl")}
                </Label>
              </div>
            ))}
          </RadioGroup>
          <p className="text-xs text-muted-foreground">{t("directionTenantNote")}</p>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-medium text-foreground">{t("personalHeading")}</legend>

        <div className="flex flex-col gap-2">
          <Label htmlFor="skin-editor-personal-mode">{t("mode")}</Label>
          <RadioGroup
            id="skin-editor-personal-mode"
            value={personalMode ?? FOLLOW}
            onValueChange={(value) =>
              onPersonalModeChange(value === FOLLOW ? null : (value as SkinEditorMode))
            }
            className="flex flex-row flex-wrap gap-3"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value={FOLLOW} id="skin-editor-personal-mode-follow" />
              <Label htmlFor="skin-editor-personal-mode-follow">
                {t("personalDirectionFollowTenant")}
              </Label>
            </div>
            {(["Light", "Dark", "System"] as const).map((mode) => (
              <div key={mode} className="flex items-center gap-2">
                <RadioGroupItem value={mode} id={`skin-editor-personal-mode-${mode}`} />
                <Label htmlFor={`skin-editor-personal-mode-${mode}`}>
                  {t(`mode${mode}` as "modeLight" | "modeDark" | "modeSystem")}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="skin-editor-personal-direction">{t("direction")}</Label>
          <RadioGroup
            id="skin-editor-personal-direction"
            value={personalDirection ?? FOLLOW}
            onValueChange={(value) =>
              onPersonalDirectionChange(value === FOLLOW ? null : (value as SkinEditorDirection))
            }
            className="flex flex-row flex-wrap gap-3"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value={FOLLOW} id="skin-editor-personal-direction-follow" />
              <Label htmlFor="skin-editor-personal-direction-follow">
                {t("personalDirectionFollowTenant")}
              </Label>
            </div>
            {(["LTR", "RTL"] as const).map((direction) => (
              <div key={direction} className="flex items-center gap-2">
                <RadioGroupItem
                  value={direction}
                  id={`skin-editor-personal-direction-${direction}`}
                />
                <Label htmlFor={`skin-editor-personal-direction-${direction}`}>
                  {t(direction === "LTR" ? "directionForceLtr" : "directionForceRtl")}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            id="skin-editor-reduced-motion"
            checked={personalReducedMotion}
            onCheckedChange={onPersonalReducedMotionChange}
          />
          <Label htmlFor="skin-editor-reduced-motion">{t("reducedMotion")}</Label>
        </div>
        <p className="text-xs text-muted-foreground">{t("reducedMotionNote")}</p>
      </fieldset>
    </div>
  );
}
