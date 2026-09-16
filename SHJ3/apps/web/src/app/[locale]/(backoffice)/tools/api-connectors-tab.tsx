"use client";

/**
 * B5 tab 3 — API connectors. A real `DataTable` (design-system.md §5.5 #41).
 *
 * ## "Test connection" tells the truth: it is not wired up yet
 *
 * `TestApiConnector`'s return type is not a union — it is
 * `{ ok: false; reason: "tools.test_execution_not_implemented" }`, always, because this app has
 * no outbound-HTTP execution path yet (that arrives with the agent runtime). The button is
 * still here, still permission-checked, and still calls the real use case; what it must never do
 * is invent a green "Tested" badge or a sample response that no request produced. So the click
 * resolves into a plain warning saying testing is not available yet — an honest result rather
 * than a fabricated one or a silently missing control.
 *
 * ## Rate-limit policy is a real form, not a hidden default
 *
 * `NewApiConnectorInput.rateLimitPolicy` is required and has no default anywhere in the module.
 * Every one of its five fields is therefore an actual input below: inventing values for them
 * would be writing a throttling policy on the operator's behalf without telling them.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { MonoSubLine } from "@/components/ui/mono-sub-line";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusCell, type StatusFamily } from "@/components/ui/status-cell";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/patterns/data-table/data-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DestructiveConfirmDialog,
} from "@/components/patterns/dialog";
import type { ApiConnectorCatalogRow } from "../../../../modules/tools/application/list-api-connectors.js";
import {
  API_CONNECTOR_AUTH_MODES,
  API_CONNECTOR_METHODS,
  RATE_LIMIT_SCOPES,
  type ApiConnectorAuthMode,
  type ApiConnectorMethod,
  type ApiConnectorTestState,
  type RateLimitScope,
} from "../../../../modules/tools/domain/tool-catalog.js";
import type { ToolsScreenActions } from "./tools-screen.js";

export interface ApiConnectorsTabProps {
  readonly rows: readonly ApiConnectorCatalogRow[];
  readonly actions: ToolsScreenActions;
}

/** Sort rank (§5.4 #39 — never alphabetical): a failed test is the row an operator is looking for. */
const TEST_STATE_RANK: Readonly<Record<ApiConnectorTestState, number>> = {
  Failed: 0,
  Untested: 1,
  Tested: 2,
};

const TEST_STATE_FAMILY: Readonly<Record<ApiConnectorTestState, StatusFamily>> = {
  Failed: "destructive",
  Untested: "neutral",
  Tested: "success",
};

/**
 * Starting values for the new-connector form's numeric fields — visible in the form and freely
 * editable before submit, never applied behind the operator's back. Named rather than inlined so
 * they read as this screen's suggested starting point, not as a policy hidden in a literal.
 */
const INITIAL_TIMEOUT_MS = 5_000;
const INITIAL_REQUESTS_PER_WINDOW = 60;
const INITIAL_WINDOW_SECONDS = 60;
const INITIAL_BURST = 10;

type DialogState =
  | { readonly kind: "none" }
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly row: ApiConnectorCatalogRow }
  | { readonly kind: "delete"; readonly row: ApiConnectorCatalogRow };

/** A blank optional field means "no value" — the ports model that as `null`, not `""`. */
function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * A whole number typed into a numeric field, or `null` when the text is not one. Returning
 * `null` (and refusing to submit) rather than coercing `""`/`"abc"` to `0` is the difference
 * between an obvious validation message and a connector silently registered with a zero timeout.
 */
function parseWholeNumber(value: string, minimum: number): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : null;
}

/** Every field `CreateApiConnector`/`UpdateApiConnector` share — the rate-limit policy is create-only and handled separately. */
interface ApiConnectorFormValues {
  readonly name: string;
  readonly method: ApiConnectorMethod;
  readonly urlTemplate: string;
  readonly authMode: ApiConnectorAuthMode;
  readonly credentialSecretRef: string | null;
  readonly headersJson: string | null;
  readonly requestSchemaJson: string | null;
  readonly responseSchemaJson: string | null;
  readonly timeoutMs: number;
}

interface RateLimitPolicyFormValues {
  readonly name: string;
  readonly requestsPerWindow: number;
  readonly windowSeconds: number;
  readonly burst: number;
  readonly scope: RateLimitScope;
}

export function ApiConnectorsTab({ rows, actions }: ApiConnectorsTabProps): React.ReactElement {
  const t = useTranslations("tools.apiConnectors");
  const router = useRouter();
  const [dialog, setDialog] = React.useState<DialogState>({ kind: "none" });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [testNotice, setTestNotice] = React.useState<string | null>(null);

  const testStateLabel = React.useCallback(
    (state: ApiConnectorTestState): string =>
      state === "Tested"
        ? t("testStateTested")
        : state === "Failed"
          ? t("testStateFailed")
          : t("testStateUntested"),
    [t],
  );

  const authModeLabels = React.useMemo<Readonly<Record<ApiConnectorAuthMode, string>>>(
    () => ({
      OAuth2ClientCredentials: t("authOauth2ClientCredentials"),
      ApiKey: t("authApiKey"),
      None: t("authNone"),
    }),
    [t],
  );

  const scopeLabels = React.useMemo<Readonly<Record<RateLimitScope, string>>>(
    () => ({
      PerTenant: t("scopePerTenant"),
      PerConversation: t("scopePerConversation"),
      PerCitizen: t("scopePerCitizen"),
      PerAgent: t("scopePerAgent"),
    }),
    [t],
  );

  const columns = React.useMemo<ColumnDef<ApiConnectorCatalogRow, unknown>[]>(
    () => [
      { id: "name", accessorKey: "name", header: t("columnName"), meta: { identifying: true } },
      {
        id: "method",
        accessorKey: "method",
        header: t("columnMethod"),
        meta: { mono: true },
      },
      {
        id: "urlTemplate",
        accessorKey: "urlTemplate",
        header: t("columnUrlTemplate"),
        cell: ({ row }) => <MonoSubLine>{row.original.urlTemplate}</MonoSubLine>,
        meta: { mono: true },
      },
      {
        id: "authMode",
        accessorKey: "authMode",
        header: t("columnAuthMode"),
        cell: ({ row }) => authModeLabels[row.original.authMode],
      },
      {
        id: "testState",
        accessorKey: "testState",
        header: t("columnTestState"),
        cell: ({ row }) => (
          <StatusCell
            label={testStateLabel(row.original.testState)}
            family={TEST_STATE_FAMILY[row.original.testState]}
            rank={TEST_STATE_RANK[row.original.testState]}
          />
        ),
        sortingFn: (a, b) =>
          TEST_STATE_RANK[a.original.testState] - TEST_STATE_RANK[b.original.testState],
      },
      {
        id: "boundAgentVersionCount",
        accessorKey: "boundAgentVersionCount",
        header: t("columnBoundVersions"),
        meta: { mono: true },
      },
    ],
    [t, authModeLabels, testStateLabel],
  );

  function onMutationSucceeded(): void {
    setDialog({ kind: "none" });
    setError(null);
    router.refresh();
  }

  async function handleTest(row: ApiConnectorCatalogRow): Promise<void> {
    setTestingId(row.id);
    setError(null);
    const result = await actions.testApiConnector(row.id);
    setTestingId(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    // `TestApiConnectorResult` has exactly one shape — the not-implemented one. Reported as
    // such, with the connector named, so the operator knows the click was received and what it
    // could not do.
    setTestNotice(t("testNotImplemented", { name: result.value.connector.name }));
  }

  async function handleDelete(row: ApiConnectorCatalogRow): Promise<void> {
    setPending(true);
    const result = await actions.deleteApiConnector(row.id);
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.value.ok) {
      setError(t("deleteInUseError", { count: result.value.boundAgentVersionIds.length }));
      return;
    }
    onMutationSucceeded();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">{t("heading")}</h2>
        <Button type="button" size="sm" onClick={() => setDialog({ kind: "create" })}>
          {t("createAction")}
        </Button>
      </div>

      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
      {testNotice ? <InlineAlert variant="warning">{testNotice}</InlineAlert> : null}

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.name}
        caption={t("heading")}
        captionVisuallyHidden
        savingRowIds={new Set(testingId ? [testingId] : [])}
        renderRowActions={(row) => (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={testingId === row.id}
              onClick={() => void handleTest(row)}
            >
              {t("testAction")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDialog({ kind: "edit", row })}
            >
              {t("editAction")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDialog({ kind: "delete", row })}
            >
              {t("deleteAction")}
            </Button>
          </div>
        )}
      />

      <p className="text-sm text-muted-foreground">{t("projectedSkillNote")}</p>

      {dialog.kind === "create" ? (
        <ApiConnectorDialog
          title={t("createDialogTitle")}
          submitLabel={t("createDialogSubmit")}
          mode={{
            kind: "create",
            onSubmit: async (values, rateLimitPolicy) => {
              setPending(true);
              const result = await actions.createApiConnector({ ...values, rateLimitPolicy });
              setPending(false);
              if (result.ok) onMutationSucceeded();
              else setError(result.error);
            },
          }}
          authModeLabels={authModeLabels}
          scopeLabels={scopeLabels}
          pending={pending}
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
        />
      ) : null}

      {dialog.kind === "edit" ? (
        <ApiConnectorDialog
          title={t("editDialogTitle")}
          submitLabel={t("editDialogSubmit")}
          mode={{
            kind: "edit",
            initial: dialog.row,
            onSubmit: async (values) => {
              setPending(true);
              const result = await actions.updateApiConnector({ id: dialog.row.id, ...values });
              setPending(false);
              if (result.ok) onMutationSucceeded();
              else setError(result.error);
            },
          }}
          authModeLabels={authModeLabels}
          scopeLabels={scopeLabels}
          pending={pending}
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
        />
      ) : null}

      {dialog.kind === "delete" ? (
        <DestructiveConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          title={t("deleteConfirmTitle")}
          objectName={dialog.row.name}
          descriptionTemplate={(name) => t("deleteConfirmDescription", { name })}
          actionLabel={t("deleteConfirmAction")}
          cancelLabel={t("cancel")}
          confirming={pending}
          onConfirm={() => void handleDelete(dialog.row)}
        />
      ) : null}
    </div>
  );
}

/**
 * Create and edit differ in exactly one way — whether a rate-limit policy is part of the
 * submission — so the mode is a discriminated union rather than a nullable callback argument.
 * That way the create path *cannot* forget the policy and the edit path *cannot* be handed one:
 * both are compile-time facts instead of a runtime guard that silently does nothing.
 */
type ApiConnectorDialogMode =
  | {
      readonly kind: "create";
      readonly onSubmit: (
        values: ApiConnectorFormValues,
        rateLimitPolicy: RateLimitPolicyFormValues,
      ) => Promise<void>;
    }
  | {
      readonly kind: "edit";
      readonly initial: ApiConnectorCatalogRow;
      readonly onSubmit: (values: ApiConnectorFormValues) => Promise<void>;
    };

interface ApiConnectorDialogProps {
  readonly title: string;
  readonly submitLabel: string;
  readonly mode: ApiConnectorDialogMode;
  readonly authModeLabels: Readonly<Record<ApiConnectorAuthMode, string>>;
  readonly scopeLabels: Readonly<Record<RateLimitScope, string>>;
  readonly pending: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * One form for create and edit. The only difference is the rate-limit policy section, which
 * exists on `NewApiConnectorInput` and deliberately not on `UpdateApiConnectorInput` — so it is
 * rendered exactly when a new connector is being registered, rather than shown-but-ignored.
 */
function ApiConnectorDialog({
  title,
  submitLabel,
  mode,
  authModeLabels,
  scopeLabels,
  pending,
  onOpenChange,
}: ApiConnectorDialogProps) {
  const t = useTranslations("tools.apiConnectors");
  const initial = mode.kind === "edit" ? mode.initial : null;
  const isCreate = mode.kind === "create";

  const [name, setName] = React.useState(initial?.name ?? "");
  const [method, setMethod] = React.useState<ApiConnectorMethod>(initial?.method ?? "GET");
  const [urlTemplate, setUrlTemplate] = React.useState(initial?.urlTemplate ?? "");
  const [authMode, setAuthMode] = React.useState<ApiConnectorAuthMode>(initial?.authMode ?? "None");
  const [credentialSecretRef, setCredentialSecretRef] = React.useState(
    initial?.credentialSecretRef ?? "",
  );
  const [headersJson, setHeadersJson] = React.useState(initial?.headersJson ?? "");
  const [requestSchemaJson, setRequestSchemaJson] = React.useState(
    initial?.requestSchemaJson ?? "",
  );
  const [responseSchemaJson, setResponseSchemaJson] = React.useState(
    initial?.responseSchemaJson ?? "",
  );
  const [timeoutMs, setTimeoutMs] = React.useState(
    String(initial?.timeoutMs ?? INITIAL_TIMEOUT_MS),
  );

  const [policyName, setPolicyName] = React.useState("");
  const [requestsPerWindow, setRequestsPerWindow] = React.useState(
    String(INITIAL_REQUESTS_PER_WINDOW),
  );
  const [windowSeconds, setWindowSeconds] = React.useState(String(INITIAL_WINDOW_SECONDS));
  const [burst, setBurst] = React.useState(String(INITIAL_BURST));
  const [scope, setScope] = React.useState<RateLimitScope>("PerTenant");

  const [numberError, setNumberError] = React.useState<string | null>(null);

  function handleSubmit(): void {
    const parsedTimeout = parseWholeNumber(timeoutMs, 1);
    if (parsedTimeout === null) {
      setNumberError(t("invalidNumberError"));
      return;
    }

    const values: ApiConnectorFormValues = {
      name,
      method,
      urlTemplate,
      authMode,
      credentialSecretRef: trimmedOrNull(credentialSecretRef),
      headersJson: trimmedOrNull(headersJson),
      requestSchemaJson: trimmedOrNull(requestSchemaJson),
      responseSchemaJson: trimmedOrNull(responseSchemaJson),
      timeoutMs: parsedTimeout,
    };

    if (mode.kind === "edit") {
      setNumberError(null);
      void mode.onSubmit(values);
      return;
    }

    const parsedRequests = parseWholeNumber(requestsPerWindow, 1);
    const parsedWindow = parseWholeNumber(windowSeconds, 1);
    const parsedBurst = parseWholeNumber(burst, 0);
    if (parsedRequests === null || parsedWindow === null || parsedBurst === null) {
      setNumberError(t("invalidNumberError"));
      return;
    }

    setNumberError(null);
    void mode.onSubmit(values, {
      name: policyName,
      requestsPerWindow: parsedRequests,
      windowSeconds: parsedWindow,
      burst: parsedBurst,
      scope,
    });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="lg" closeLabel={t("closeLabel")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          <FormField label={t("fieldName")}>
            {(field) => (
              <Input
                {...field}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            )}
          </FormField>
          <FormField label={t("fieldMethod")}>
            {(field) => (
              <Select
                value={method}
                onValueChange={(value) => setMethod(value as ApiConnectorMethod)}
              >
                <SelectTrigger {...field} variant="mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {API_CONNECTOR_METHODS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label={t("fieldUrlTemplate")} help={t("fieldUrlTemplateHelp")}>
            {(field) => (
              <Input
                {...field}
                dir="ltr"
                value={urlTemplate}
                onChange={(event) => setUrlTemplate(event.target.value)}
                required
              />
            )}
          </FormField>
          <FormField label={t("fieldAuthMode")}>
            {(field) => (
              <Select
                value={authMode}
                onValueChange={(value) => setAuthMode(value as ApiConnectorAuthMode)}
              >
                <SelectTrigger {...field}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {API_CONNECTOR_AUTH_MODES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {authModeLabels[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label={t("fieldCredentialSecretRef")} labelVariant="optional">
            {(field) => (
              <Input
                {...field}
                dir="ltr"
                value={credentialSecretRef}
                onChange={(event) => setCredentialSecretRef(event.target.value)}
              />
            )}
          </FormField>
          <FormField
            label={t("fieldTimeoutMs")}
            {...(numberError !== null ? { error: numberError } : {})}
          >
            {(field) => (
              <Input
                {...field}
                type="number"
                inputMode="numeric"
                value={timeoutMs}
                onChange={(event) => setTimeoutMs(event.target.value)}
                required
              />
            )}
          </FormField>
          <FormField label={t("fieldHeadersJson")} labelVariant="optional">
            {(field) => (
              <Textarea
                {...field}
                dir="ltr"
                value={headersJson}
                onChange={(event) => setHeadersJson(event.target.value)}
              />
            )}
          </FormField>
          <FormField label={t("fieldRequestSchemaJson")} labelVariant="optional">
            {(field) => (
              <Textarea
                {...field}
                dir="ltr"
                value={requestSchemaJson}
                onChange={(event) => setRequestSchemaJson(event.target.value)}
              />
            )}
          </FormField>
          <FormField label={t("fieldResponseSchemaJson")} labelVariant="optional">
            {(field) => (
              <Textarea
                {...field}
                dir="ltr"
                value={responseSchemaJson}
                onChange={(event) => setResponseSchemaJson(event.target.value)}
              />
            )}
          </FormField>

          {isCreate ? (
            <div className="flex flex-col gap-4 border-t border-border pt-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-medium text-foreground">{t("rateLimitHeading")}</h3>
                <p className="text-sm text-muted-foreground">{t("rateLimitHelp")}</p>
              </div>
              <FormField label={t("fieldPolicyName")}>
                {(field) => (
                  <Input
                    {...field}
                    value={policyName}
                    onChange={(event) => setPolicyName(event.target.value)}
                    required
                  />
                )}
              </FormField>
              <FormField label={t("fieldRequestsPerWindow")}>
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    inputMode="numeric"
                    value={requestsPerWindow}
                    onChange={(event) => setRequestsPerWindow(event.target.value)}
                    required
                  />
                )}
              </FormField>
              <FormField label={t("fieldWindowSeconds")}>
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    inputMode="numeric"
                    value={windowSeconds}
                    onChange={(event) => setWindowSeconds(event.target.value)}
                    required
                  />
                )}
              </FormField>
              <FormField label={t("fieldBurst")}>
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    inputMode="numeric"
                    value={burst}
                    onChange={(event) => setBurst(event.target.value)}
                    required
                  />
                )}
              </FormField>
              <FormField label={t("fieldScope")}>
                {(field) => (
                  <Select
                    value={scope}
                    onValueChange={(value) => setScope(value as RateLimitScope)}
                  >
                    <SelectTrigger {...field}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RATE_LIMIT_SCOPES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {scopeLabels[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" loading={pending}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
