"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { typeboxResolver } from "@hookform/resolvers/typebox";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@nextbot/ui/components/ui/form";
import { CreateWebWidgetChannelRequestSchema, type CreateWebWidgetChannelRequest } from "@nextbot/contracts";
import { humanizeFieldError } from "../../../../src/lib/humanize-field-error";

const ENVIRONMENTS = ["Sandbox", "Staging", "Production"] as const;

/**
 * Step 1 of the WhatsApp channel flow (FR-OC-03): creates the channel shell
 * (name + environment only — same minimal shape as the Web Widget form), then
 * routes into the full WhatsApp config screen (§7.2) where Meta linking/WABA/
 * credentials/templates/consent are configured.
 */
export function CreateWhatsAppChannelForm() {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<CreateWebWidgetChannelRequest>({
    resolver: typeboxResolver(CreateWebWidgetChannelRequestSchema),
    defaultValues: { name: "", environment: "Sandbox" },
  });
  const {
    handleSubmit,
    formState: { isSubmitting },
  } = form;

  async function onSubmit(values: CreateWebWidgetChannelRequest) {
    setSubmitError(null);
    const res = await fetch("/api/v1/admin/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "WhatsApp", ...values }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setSubmitError(data.title ?? "Failed to create channel.");
      return;
    }
    const { channel } = await res.json();
    router.push(`/channels/${channel.id}/whatsapp`);
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 font-heading text-lg font-semibold">Add WhatsApp Channel</h1>
      <Form {...form}>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
          <FormField
            control={form.control}
            name="name"
            render={({ field, fieldState }) => (
              <FormItem>
                <div className="flex items-center gap-1">
                  <FormLabel>Name*</FormLabel>
                  <FieldHint
                    id="create-whatsapp-channel-form-name-hint"
                    content="The display name shown for this channel in the Channels list and elsewhere in the admin console — purely descriptive, it doesn't affect the WABA connection or routing configured on the next screen."
                  />
                </div>
                <FormControl>
                  <Input placeholder="Main WhatsApp Line" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage>{humanizeFieldError("name", fieldState.error?.message)}</FormMessage>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="environment"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center gap-1">
                  <FormLabel>Environment*</FormLabel>
                  <FieldHint
                    id="create-whatsapp-channel-form-environment-hint"
                    content="Labels this channel instance as Sandbox, Staging, or Production — organizational only, so otherwise-identically-named test and live instances can be told apart in the Channels list; it isn't enforced against where messages actually get sent."
                  />
                </div>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ENVIRONMENTS.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />

          {submitError && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Continue to WhatsApp setup"}
          </Button>
        </form>
      </Form>
    </div>
  );
}
