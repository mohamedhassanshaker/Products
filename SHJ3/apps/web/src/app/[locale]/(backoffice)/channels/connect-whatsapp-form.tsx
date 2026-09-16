"use client";

/**
 * B10 tab 3's real "Connect WhatsApp" onboarding form — renders in place of the bare
 * "not provisioned" text whenever `whatsAppSettings` is null (a `Channel` row exists —
 * `ProvisionDefaultChannelsForTenant` gives every tenant one now — but no `WhatsAppConfig`
 * row does yet). See `ConnectWhatsApp`'s own doc comment (`modules/channels/application/
 * connect-whatsapp.ts`) for why this never calls the real Meta Graph API: no sandbox
 * credentials exist in this environment, so this form persists real, admin-supplied
 * configuration only.
 *
 * The two secret fields are *references* (`env:NAME`, `k8s:...`, `vault:...`), never real
 * secret values — architecture §10's own convention, identical to how MCP servers/API
 * connectors already record their credentials in this codebase.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { connectWhatsAppAction } from "./actions.js";

export interface ConnectWhatsAppFormProps {
  readonly channelId: string;
  readonly connectWhatsApp: typeof connectWhatsAppAction;
}

export function ConnectWhatsAppForm({
  channelId,
  connectWhatsApp,
}: ConnectWhatsAppFormProps): React.ReactElement {
  const t = useTranslations("channels.whatsapp.connect");
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = React.useState("");
  const [phoneNumberId, setPhoneNumberId] = React.useState("");
  const [wabaId, setWabaId] = React.useState("");
  const [optInRequired, setOptInRequired] = React.useState(true);
  const [credentialSecretRef, setCredentialSecretRef] = React.useState("");
  const [webhookVerifySecretRef, setWebhookVerifySecretRef] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const optInId = React.useId();

  async function handleSubmit(): Promise<void> {
    setPending(true);
    setError(null);
    const result = await connectWhatsApp({
      channelId,
      phoneNumber,
      phoneNumberId,
      wabaId,
      optInRequired,
      credentialSecretRef,
      webhookVerifySecretRef,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.value.ok) {
      setError(t(`reason.${result.value.reason}`, { defaultValue: result.value.reason }));
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">{t("heading")}</h2>
        <p className="text-sm text-muted-foreground">{t("explanation")}</p>
      </div>
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <FormField label={t("fieldPhoneNumber")}>
          {(field) => (
            <Input
              {...field}
              dir="ltr"
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              required
            />
          )}
        </FormField>
        <FormField label={t("fieldPhoneNumberId")} help={t("fieldPhoneNumberIdHelp")}>
          {(field) => (
            <Input
              {...field}
              variant="mono"
              value={phoneNumberId}
              onChange={(event) => setPhoneNumberId(event.target.value)}
              required
            />
          )}
        </FormField>
        <FormField label={t("fieldWabaId")}>
          {(field) => (
            <Input
              {...field}
              variant="mono"
              value={wabaId}
              onChange={(event) => setWabaId(event.target.value)}
              required
            />
          )}
        </FormField>
        <FormField label={t("fieldCredentialSecretRef")} help={t("fieldCredentialSecretRefHelp")}>
          {(field) => (
            <Input
              {...field}
              variant="mono"
              value={credentialSecretRef}
              onChange={(event) => setCredentialSecretRef(event.target.value)}
              placeholder="env:SEWA_WHATSAPP_TOKEN"
              required
            />
          )}
        </FormField>
        <FormField
          label={t("fieldWebhookVerifySecretRef")}
          help={t("fieldWebhookVerifySecretRefHelp")}
        >
          {(field) => (
            <Input
              {...field}
              variant="mono"
              value={webhookVerifySecretRef}
              onChange={(event) => setWebhookVerifySecretRef(event.target.value)}
              placeholder="env:SEWA_WHATSAPP_WEBHOOK_VERIFY"
              required
            />
          )}
        </FormField>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={optInId}>{t("fieldOptInRequired")}</Label>
          <Switch id={optInId} checked={optInRequired} onCheckedChange={setOptInRequired} />
        </div>
        <div>
          <Button type="submit" loading={pending}>
            {t("connectAction")}
          </Button>
        </div>
      </form>
    </div>
  );
}
