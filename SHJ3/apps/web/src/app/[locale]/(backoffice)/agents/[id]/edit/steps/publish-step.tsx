"use client";

/**
 * B3 step 10 — Publish. Environment is fixed to Development (no real promotion mechanism
 * exists yet — that is B-9's scope, per this wave's own explicit stub decision) rather than
 * faking a UAT/Production picker the rest of the system cannot actually honour. The
 * "Publish agent" primary action itself is owned by `Wizard`'s `onPublish` prop (wired in
 * `wizard-shell.tsx`) — this component is read-only summary + the blocking-reasons list.
 */

import { useTranslations } from "next-intl";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { WizardStepId } from "../../../../../../../modules/agents/domain/agent.js";

export interface PublishStepProps {
  readonly currentLabel: string;
  readonly publishedLabel: string;
  readonly blocked: boolean;
  readonly missingSteps: readonly WizardStepId[];
  readonly canPublish: boolean;
  readonly publishing: boolean;
}

export function PublishStep({
  currentLabel,
  publishedLabel,
  blocked,
  missingSteps,
  canPublish,
  publishing,
}: PublishStepProps): React.ReactElement {
  const t = useTranslations("agents.wizard.publish");
  return (
    // `max-w-lg` was a dead class: this bridge's `--container-*` reset is never
    // re-mapped (tailwind-theme.ts, ADR-0007 "replace, not extend"), so no `max-w-*`
    // utility compiles — the same confirmed-empty gap already fixed at
    // `sign-in-form.tsx`. Reproduced as the literal `rem` value `max-w-lg` would have
    // used (32rem), unaffected by the token gate's `px|pt|em`-only length pattern.
    <div className="flex flex-col gap-4" style={{ maxWidth: "32rem" }}>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">{t("environmentLabel")}</span>
        <span className="text-sm text-muted-foreground">{t("environmentFixedToDevelopment")}</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">{t("versionLabel")}</span>
        <span className="font-mono text-sm text-foreground">
          {t("versionTransition", { from: currentLabel, to: publishedLabel })}
        </span>
      </div>
      {!canPublish ? <InlineAlert variant="warning">{t("noPublishPermission")}</InlineAlert> : null}
      {blocked ? (
        <InlineAlert variant="destructive">
          {t("blockedIntro")}
          <ul className="mt-1 list-disc ps-5">
            {missingSteps.map((step) => (
              <li key={step}>{t(`missingStep.${step}`)}</li>
            ))}
          </ul>
        </InlineAlert>
      ) : null}
      {publishing ? <p className="text-sm text-muted-foreground">{t("publishing")}</p> : null}
    </div>
  );
}
