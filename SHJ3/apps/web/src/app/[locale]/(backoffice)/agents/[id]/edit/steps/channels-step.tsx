"use client";

/** B3 step 8 — Channels. `WIZARD_CHANNEL_KEYS` is the 3-key subset this step actually renders (`WebWidget`/`WhatsApp`/`KioskIvr` — `MobileApp` exists in the domain enum but has no B3 UI yet). */

import { useTranslations } from "next-intl";
import { SelectablePill } from "@/components/ui/selectable-pill";
import {
  WIZARD_CHANNEL_KEYS,
  type ChannelKey,
} from "../../../../../../../modules/agents/domain/agent.js";

export interface ChannelsStepProps {
  readonly enabledChannelKeys: readonly ChannelKey[];
  readonly onChange: (keys: readonly ChannelKey[]) => void;
}

export function ChannelsStep({
  enabledChannelKeys,
  onChange,
}: ChannelsStepProps): React.ReactElement {
  const t = useTranslations("agents.wizard.channels");
  return (
    // `max-w-lg` was a dead class: this bridge's `--container-*` reset is never
    // re-mapped (tailwind-theme.ts, ADR-0007 "replace, not extend"), so no `max-w-*`
    // utility compiles — the same confirmed-empty gap already fixed at
    // `sign-in-form.tsx`. Reproduced as the literal `rem` value `max-w-lg` would have
    // used (32rem), unaffected by the token gate's `px|pt|em`-only length pattern.
    <div className="flex flex-col gap-3" style={{ maxWidth: "32rem" }}>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <div className="flex flex-wrap gap-2">
        {WIZARD_CHANNEL_KEYS.map((key) => (
          <SelectablePill
            key={key}
            variant="multi"
            checked={enabledChannelKeys.includes(key)}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...enabledChannelKeys, key]
                  : enabledChannelKeys.filter((k) => k !== key),
              )
            }
          >
            {t(`channel.${key}`)}
          </SelectablePill>
        ))}
      </div>
    </div>
  );
}
