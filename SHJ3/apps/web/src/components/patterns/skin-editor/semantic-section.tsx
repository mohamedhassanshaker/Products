"use client";

/**
 * §9.1's Semantic section: success/warning/destructive/info, each with
 * fill/foreground/subtle/strong, plus the "Match brand" bulk action — "seeds
 * `--success` from `--primary`, with an explicit warning that it will change the
 * appearance of every Healthy/Passed/Approved badge (§4.3)."
 *
 * "Match brand" seeds exactly the two tokens §9.1's own sentence names, singular —
 * `success` from `primary`, and (so the fill's label text stays legible)
 * `successForeground` from `primaryForeground`. `successSubtle`/`successStrong` are
 * deliberately left untouched: deriving a subtle tint or a readable-on-subtle
 * "strong" shade from an arbitrary admin-chosen hex needs a real colour-manipulation
 * algorithm this codebase does not have (the same reasoning
 * `contrast-report-to-conditions.ts` already gives for not inventing a
 * nearest-passing-value suggester) — narrower than a literal reading of "seeds
 * --success" might suggest, but honest about what a single-token copy can safely do
 * without guessing at tints no one asked for.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import type { SemanticColorTokenName, SemanticColorTokens } from "@shj3/tokens";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/patterns/dialog";
import { ColorField } from "./color-field.js";

export interface SemanticSectionProps {
  readonly tokens: SemanticColorTokens;
  readonly onTokenChange: (key: SemanticColorTokenName, value: string) => void;
  readonly disabled: boolean;
}

const FAMILIES = [
  {
    familyKey: "success",
    fill: "success",
    foreground: "successForeground",
    subtle: "successSubtle",
    strong: "successStrong",
  },
  {
    familyKey: "warning",
    fill: "warning",
    foreground: "warningForeground",
    subtle: "warningSubtle",
    strong: "warningStrong",
  },
  {
    familyKey: "destructive",
    fill: "destructive",
    foreground: "destructiveForeground",
    subtle: "destructiveSubtle",
    strong: "destructiveStrong",
  },
  {
    familyKey: "info",
    fill: "info",
    foreground: "infoForeground",
    subtle: "infoSubtle",
    strong: "infoStrong",
  },
] as const satisfies readonly {
  familyKey: string;
  fill: SemanticColorTokenName;
  foreground: SemanticColorTokenName;
  subtle: SemanticColorTokenName;
  strong: SemanticColorTokenName;
}[];

export function SemanticSection({ tokens, onTokenChange, disabled }: SemanticSectionProps) {
  const t = useTranslations("skinEditor.semantic");
  const tColorField = useTranslations("skinEditor.colorField");
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const applyMatchBrand = () => {
    onTokenChange("success", tokens.primary);
    onTokenChange("successForeground", tokens.primaryForeground);
    setConfirmOpen(false);
  };

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-6">
      <legend className="sr-only">{t("heading")}</legend>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">{t("heading")}</h3>
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
          {t("matchBrandAction")}
        </Button>
      </div>

      {FAMILIES.map((family) => (
        <div key={family.familyKey} className="flex flex-col gap-3">
          <h4 className="text-sm font-medium text-muted-foreground">{t(family.familyKey)}</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(["fill", "foreground", "subtle", "strong"] as const).map((slot) => {
              const key = family[slot];
              return (
                <ColorField
                  key={key}
                  id={`skin-editor-semantic-${key}`}
                  label={`${t(family.familyKey)} — ${t(slot)}`}
                  value={tokens[key]}
                  onChange={(value) => onTokenChange(key, value)}
                  invalidMessage={tColorField("invalidHex")}
                />
              );
            })}
          </div>
        </div>
      ))}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t("matchBrandConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("matchBrandConfirmBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("matchBrandConfirmCancel")}
            </Button>
            <Button type="button" variant="primary" onClick={applyMatchBrand}>
              {t("matchBrandConfirmAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </fieldset>
  );
}
