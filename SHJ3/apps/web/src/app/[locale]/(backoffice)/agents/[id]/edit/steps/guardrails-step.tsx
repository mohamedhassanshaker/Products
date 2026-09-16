"use client";

/**
 * B3 step 7 — Guardrails. Real toggles against `PolicyOverrideRepository`, per this wave's
 * own "real, not stubbed" instruction: `mask_pii_in_transcripts` is permanently locked (shown
 * checked and disabled — no `platform.OverridablePolicy` row ever exists for it, so it can
 * never leave `"Default"`), `grounding_threshold` and `allow_competitor_discussion` are real,
 * live overrides. Each toggle writes immediately (`setGuardrailOverrideAction`) rather than
 * batching into "Save & continue" — matches how B3 step 4's bind/unbind is also immediate,
 * not deferred to a step-level commit.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Switch } from "@/components/ui/switch";
import type { GuardrailSettingRow } from "../../../../../../../modules/agents/application/get-guardrail-settings.js";
import type { setGuardrailOverrideAction } from "../../../actions.js";

export interface GuardrailsStepProps {
  readonly agentId: string;
  readonly guardrails: readonly GuardrailSettingRow[];
  readonly setGuardrailOverride: typeof setGuardrailOverrideAction;
}

export function GuardrailsStep({
  agentId,
  guardrails,
  setGuardrailOverride,
}: GuardrailsStepProps): React.ReactElement {
  const t = useTranslations("agents.wizard.guardrails");
  const [rows, setRows] = React.useState(guardrails);
  const [pendingKey, setPendingKey] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function toggle(row: GuardrailSettingRow, enabled: boolean): Promise<void> {
    setPendingKey(row.policyKey);
    setError(null);
    const result = await setGuardrailOverride({
      agentId,
      policyKey: row.policyKey,
      mode: enabled ? "Value" : "Disabled",
      valueJson: row.valueJson,
      reason: t("defaultReason"),
    });
    setPendingKey(null);
    if (!result.ok) {
      setError(t(`reason.${result.reason}`, { defaultValue: result.reason }));
      return;
    }
    setRows((current) =>
      current.map((r) =>
        r.policyKey === row.policyKey ? { ...r, currentMode: enabled ? "Value" : "Disabled" } : r,
      ),
    );
  }

  return (
    // `max-w-xl` was a dead class: this bridge's `--container-*` reset is never
    // re-mapped (tailwind-theme.ts, ADR-0007 "replace, not extend"), so no `max-w-*`
    // utility compiles — the same confirmed-empty gap already fixed at
    // `sign-in-form.tsx`. Reproduced as the literal `rem` value `max-w-xl` would have
    // used (36rem), unaffected by the token gate's `px|pt|em`-only length pattern.
    <div className="flex flex-col gap-3" style={{ maxWidth: "36rem" }}>
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
      {rows.map((row) => {
        const enabled = row.currentMode === "Value" || row.currentMode === "Default";
        return (
          <div
            key={row.policyKey}
            className="flex items-center justify-between gap-3 border-b border-border pb-3"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">{row.title}</span>
              {row.isLocked ? (
                <span className="text-xs text-muted-foreground">{t("lockedNote")}</span>
              ) : null}
            </div>
            <Switch
              checked={enabled}
              disabled={row.isLocked || pendingKey === row.policyKey}
              onCheckedChange={(checked) => void toggle(row, checked)}
              aria-label={row.title}
            />
          </div>
        );
      })}
    </div>
  );
}
