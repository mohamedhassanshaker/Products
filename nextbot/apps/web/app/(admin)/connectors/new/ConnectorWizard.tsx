"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { typeboxResolver } from "@hookform/resolvers/typebox";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@nextbot/ui/components/ui/form";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { CreateConnectorRequestSchema, type CreateConnectorRequest } from "@nextbot/contracts";
import { humanizeFieldError } from "../../../../src/lib/humanize-field-error";

const BACKEND_TYPES = ["Ticketing", "CRM", "ERP", "Billing", "HRIS", "KnowledgeBase", "Custom"] as const;
const ENVIRONMENTS = ["Sandbox", "Staging", "Production"] as const;
const AUTH_METHODS = ["None", "APIKey", "BearerToken", "OAuth2", "CustomHeader", "mTLS"] as const;

/**
 * Add Connector wizard (BL-02 UI slice, `docs/design/UX_GUIDELINES.md` §3).
 * Implemented as a single-page form with sectioned fieldsets rather than a literal
 * multi-step wizard component — deliberately simplified for this dispatch's time
 * budget; the field grouping/order (identity → transport/auth → credential) still
 * matches the guidance's step shape, and React Hook Form + a TypeBox resolver (LLD
 * §1) still validate exactly as a "real" wizard's final submit step would.
 *
 * First RHF-based form converted to shadcn's `Form`/`FormField` in this migration
 * sweep (`packages/ui/src/components/ui/form.tsx`) — every field still routes its
 * humanized error message (QA Defect U10) through `FormMessage`.
 */
export function ConnectorWizard() {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<CreateConnectorRequest>({
    resolver: typeboxResolver(CreateConnectorRequestSchema),
    // `credentialPlaintext` deliberately has no default value here (left
    // `undefined`, not `""`) — the schema's `Type.Optional(Type.String({
    // minLength: 1 }))` accepts an omitted/`undefined` value but rejects an
    // empty string. Its `FormField` below also sets `shouldUnregister` so RHF
    // drops the value entirely once the field unmounts (`authMethod` back to
    // `"None"`), matching the old `register()`-based version's behavior where
    // an unmounted registered field's value was removed from the form state.
    defaultValues: {
      name: "",
      description: "",
      endpointUrl: "",
      transport: "StreamableHTTP",
      authMethod: "None",
      environment: "Sandbox",
    },
  });
  const {
    handleSubmit,
    watch,
    formState: { isSubmitting },
  } = form;

  const authMethod = watch("authMethod");

  async function onSubmit(values: CreateConnectorRequest) {
    setSubmitError(null);
    const res = await fetch("/api/v1/admin/connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setSubmitError(data.title ?? "Failed to create connector.");
      return;
    }
    router.push("/connectors");
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 font-heading text-lg font-semibold">Add Connector</h1>
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
                    id="connector-wizard-name-hint"
                    content="A tenant-unique label for this connector within its environment — shown throughout the console (connector list, tool catalog, health dashboard) to identify where a discovered tool came from."
                  />
                </div>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage>{humanizeFieldError("name", fieldState.error?.message)}</FormMessage>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center gap-1">
                  <FormLabel>Description</FormLabel>
                  <FieldHint
                    id="connector-wizard-description-hint"
                    content="Free-text notes about this connector's purpose or ownership — display-only, never used by the discovery or routing logic."
                  />
                </div>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="backendType"
            render={({ field, fieldState }) => (
              <FormItem>
                <div className="flex items-center gap-1">
                  <FormLabel>Backend type*</FormLabel>
                  <FieldHint
                    id="connector-wizard-backend-type-hint"
                    content="What kind of system this connector talks to — filters which connector templates and default field mappings apply, and is shown as a column in the connector list."
                  />
                </div>
                <Select value={field.value ?? ""} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select backend type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {BACKEND_TYPES.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage>{humanizeFieldError("backendType", fieldState.error?.message)}</FormMessage>
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
                    id="connector-wizard-environment-hint"
                    content="Which of the tenant's environments this connector belongs to — connectors are scoped per environment, so a Sandbox connector's discovered tools never show up for a Production agent, and vice versa."
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

          <FormField
            control={form.control}
            name="transport"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center gap-1">
                  <FormLabel>Transport*</FormLabel>
                  <FieldHint
                    id="connector-wizard-transport-hint"
                    content="How the platform's MCP client opens the connection to this server — Stdio via Gateway Agent isn't available yet (BL-22), so Streamable HTTP is the only usable choice today."
                  />
                </div>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="StreamableHTTP">Streamable HTTP</SelectItem>
                    <SelectItem value="StdioViaGateway" disabled>
                      Stdio via Gateway Agent (not available yet — BL-22)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="endpointUrl"
            render={({ field, fieldState }) => (
              <FormItem>
                <div className="flex items-center gap-1">
                  <FormLabel>Endpoint URL (https only)*</FormLabel>
                  <FieldHint
                    id="connector-wizard-endpoint-url-hint"
                    content="The MCP server's base URL the platform connects to for tool discovery and invocation — must be https, plain http endpoints are rejected before the round trip to the server."
                  />
                </div>
                <FormControl>
                  <Input placeholder="https://" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage>{humanizeFieldError("endpointUrl", fieldState.error?.message)}</FormMessage>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="authMethod"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center gap-1">
                  <FormLabel>Authentication method*</FormLabel>
                  <FieldHint
                    id="connector-wizard-auth-method-hint"
                    content="How the platform authenticates its own requests to this connector's endpoint — choosing anything other than None reveals the Credential value field below, which is vaulted, never stored in plaintext."
                  />
                </div>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {AUTH_METHODS.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />

          {authMethod !== "None" && (
            <FormField
              control={form.control}
              name="credentialPlaintext"
              shouldUnregister
              render={({ field, fieldState }) => (
                <FormItem>
                  <div className="flex items-center gap-1">
                    <FormLabel>Credential value*</FormLabel>
                    <FieldHint
                      id="connector-wizard-credential-hint"
                      content="The secret material for the chosen authentication method (e.g. an API key or bearer token) — hashed/vaulted on submit and never displayed again in plaintext once saved."
                    />
                  </div>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage>{humanizeFieldError("credentialPlaintext", fieldState.error?.message)}</FormMessage>
                </FormItem>
              )}
            />
          )}

          {submitError && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create connector"}
          </Button>
        </form>
      </Form>
    </div>
  );
}
