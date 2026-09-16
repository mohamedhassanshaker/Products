"use client";

/**
 * `/ai-settings` — the Flow Designer AI sidebar's tenant-wide model, as a real form instead
 * of an env edit plus a container recreate. Two free-text fields, matching `basic-steps.tsx`'s
 * Model step (`AgentVersion.primaryModel`/`fallbackModel`) exactly — no model allowlist exists
 * anywhere in this codebase to validate against.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { FlowAssistantConfigRow } from "../../../../modules/flows/ports/flow-assistant-config-repository.js";
import type { updateFlowAssistantConfigAction } from "../agents/actions.js";

export interface AiSettingsScreenActions {
  readonly updateFlowAssistantConfig: typeof updateFlowAssistantConfigAction;
}

export interface AiSettingsScreenProps {
  readonly config: FlowAssistantConfigRow;
  readonly actions: AiSettingsScreenActions;
}

export function AiSettingsScreen({ config, actions }: AiSettingsScreenProps): React.ReactElement {
  const t = useTranslations("aiSettings");
  const router = useRouter();

  const [primaryModel, setPrimaryModel] = React.useState(config.primaryModel);
  const [fallbackModel, setFallbackModel] = React.useState(config.fallbackModel ?? "");
  const [pendingSave, setPendingSave] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPendingSave(true);
    const result = await actions.updateFlowAssistantConfig({
      primaryModel,
      fallbackModel: fallbackModel.trim().length > 0 ? fallbackModel : null,
    });
    setPendingSave(false);

    if (!result.ok) {
      setError(result.error);
      setNotice(null);
      return;
    }
    if (!result.value.ok) {
      setError(t(`saveError.${result.value.reason}`));
      setNotice(null);
      return;
    }
    setError(null);
    setNotice(t("savedNotice"));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
      {notice ? <InlineAlert variant="success">{notice}</InlineAlert> : null}

      <form className="flex flex-col gap-4" style={{ maxWidth: "32rem" }} onSubmit={handleSubmit}>
        <FormField label={t("primaryModelLabel")} help={t("primaryModelHelp")}>
          {(field) => (
            <Input
              {...field}
              dir="ltr"
              variant="mono"
              value={primaryModel}
              onChange={(event) => setPrimaryModel(event.target.value)}
              required
            />
          )}
        </FormField>
        <FormField label={t("fallbackModelLabel")} help={t("fallbackModelHelp")}>
          {(field) => (
            <Input
              {...field}
              dir="ltr"
              variant="mono"
              value={fallbackModel}
              onChange={(event) => setFallbackModel(event.target.value)}
            />
          )}
        </FormField>
        <div>
          <Button type="submit" loading={pendingSave}>
            {t("saveAction")}
          </Button>
        </div>
      </form>
    </div>
  );
}
