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

/** Add Web Widget Channel form (BL-04 prerequisite). Intentionally minimal (name +
 * environment only) — see `ChannelsList.tsx`'s doc comment for why the full
 * FR-OC-03 per-channel-type wizard is out of scope here. */
export function CreateChannelForm() {
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
      body: JSON.stringify({ type: "WebWidget", ...values }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setSubmitError(data.title ?? "Failed to create channel.");
      return;
    }
    router.push("/channels");
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 font-heading text-lg font-semibold">Add Web Widget Channel</h1>
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
                    id="create-channel-form-name-hint"
                    content="The display name shown for this channel in the Channels list and elsewhere in the admin console — purely descriptive, it doesn't affect the channel's embed key or routing."
                  />
                </div>
                <FormControl>
                  <Input placeholder="Main Website Widget" {...field} value={field.value ?? ""} />
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
                    id="create-channel-form-environment-hint"
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
            {isSubmitting ? "Creating…" : "Create channel"}
          </Button>
        </form>
      </Form>
    </div>
  );
}
