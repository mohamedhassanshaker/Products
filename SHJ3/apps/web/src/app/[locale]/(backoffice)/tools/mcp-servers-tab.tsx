"use client";

/**
 * B5 tab 2 — MCP servers. A real `DataTable` (design-system.md §5.5 #41), with each server's
 * discovered tools in its own expandable row region.
 *
 * ## "Connect & discover" reports what actually happened — including that it cannot happen yet
 *
 * `apps/ai` owns the real MCP client; this app's `AiServiceMcpDiscoveryClient` is a documented
 * proxy to an `apps/ai` endpoint that **does not exist yet** (architecture.md's module map,
 * api.md §6.5). So a real click against the real stack resolves
 * `{ ok: false, reason: "ai_runtime_unavailable", detail }`, and this tab prints that `detail`
 * verbatim as the reason.
 *
 * That distinction is the whole point of the branch existing: `dns`/`tls`/`auth`/`timeout`/
 * `protocol` mean "we reached for the server and it went wrong", which would be a false
 * accusation against a perfectly healthy MCP server when the truth is that the caller's own
 * runtime is absent. Nothing here retries, and nothing collapses these into one "connection
 * failed" message.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert, type InlineAlertVariant } from "@/components/ui/inline-alert";
import { MonoSubLine } from "@/components/ui/mono-sub-line";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusCell, type StatusFamily } from "@/components/ui/status-cell";
import { DataTable } from "@/components/patterns/data-table/data-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DestructiveConfirmDialog,
} from "@/components/patterns/dialog";
import type { ConnectAndDiscoverMcpServerResult } from "../../../../modules/tools/application/connect-and-discover-mcp-server.js";
import {
  MCP_AUTH_MODES,
  MCP_TRANSPORTS,
  type McpAuthMode,
  type McpConnectionState,
  type McpTransport,
} from "../../../../modules/tools/domain/tool-catalog.js";
import type { McpServerWithTools, ToolsScreenActions } from "./tools-screen.js";

export interface McpServersTabProps {
  readonly rows: readonly McpServerWithTools[];
  readonly actions: ToolsScreenActions;
}

/** Sort rank (§5.4 #39 — never alphabetical): a failed connection is what an operator opens this tab to find, so it sorts first. */
const CONNECTION_RANK: Readonly<Record<McpConnectionState, number>> = {
  Failed: 0,
  NotConnected: 1,
  Connected: 2,
};

const CONNECTION_FAMILY: Readonly<Record<McpConnectionState, StatusFamily>> = {
  Failed: "destructive",
  NotConnected: "neutral",
  Connected: "success",
};

type DialogState =
  | { readonly kind: "none" }
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly row: McpServerWithTools }
  | { readonly kind: "delete"; readonly row: McpServerWithTools };

/** One server's last discovery attempt, rendered in that server's expanded row. */
interface DiscoveryOutcome {
  readonly variant: InlineAlertVariant;
  readonly message: string;
}

/** A blank optional field means "no value" — the ports model that as `null`, not `""`. */
function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The editable shape of an MCP server registration — identical for create and edit, so one form serves both. */
interface McpServerFormValues {
  readonly name: string;
  readonly endpoint: string;
  readonly transport: McpTransport;
  readonly authMode: McpAuthMode;
  readonly credentialSecretRef: string | null;
}

export function McpServersTab({ rows, actions }: McpServersTabProps): React.ReactElement {
  const t = useTranslations("tools.mcpServers");
  const router = useRouter();
  const [dialog, setDialog] = React.useState<DialogState>({ kind: "none" });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [discoveringId, setDiscoveringId] = React.useState<string | null>(null);
  const [expandedIds, setExpandedIds] = React.useState<ReadonlySet<string>>(new Set());
  const [outcomes, setOutcomes] = React.useState<Readonly<Record<string, DiscoveryOutcome>>>({});

  const connectionLabel = React.useCallback(
    (state: McpConnectionState): string =>
      state === "Connected"
        ? t("stateConnected")
        : state === "Failed"
          ? t("stateFailed")
          : t("stateNotConnected"),
    [t],
  );

  const transportLabels = React.useMemo<Readonly<Record<McpTransport, string>>>(
    () => ({
      Stdio: t("transportStdio"),
      Sse: t("transportSse"),
      StreamableHttp: t("transportStreamableHttp"),
    }),
    [t],
  );

  const authModeLabels = React.useMemo<Readonly<Record<McpAuthMode, string>>>(
    () => ({
      OAuth2ClientCredentials: t("authOauth2ClientCredentials"),
      MutualTls: t("authMutualTls"),
      ApiKey: t("authApiKey"),
      None: t("authNone"),
    }),
    [t],
  );

  /**
   * Every branch of `ConnectAndDiscoverMcpServerResult`, mapped to its own honest message.
   * Written as an exhaustive switch rather than a lookup table so adding a new reason to the
   * use case is a compile error here, not a silently unhandled outcome.
   */
  const describeOutcome = React.useCallback(
    (result: ConnectAndDiscoverMcpServerResult): DiscoveryOutcome => {
      if (result.ok) {
        return {
          variant: "success",
          message: t("discoverySucceeded", { count: result.tools.length }),
        };
      }
      switch (result.reason) {
        case "tools.server_not_found":
          return { variant: "destructive", message: t("discoveryServerNotFound") };
        case "dns":
          return { variant: "destructive", message: t("discoveryFailedDns") };
        case "tls":
          return { variant: "destructive", message: t("discoveryFailedTls") };
        case "auth":
          return { variant: "destructive", message: t("discoveryFailedAuth") };
        case "timeout":
          return { variant: "destructive", message: t("discoveryFailedTimeout") };
        case "protocol":
          return { variant: "destructive", message: t("discoveryFailedProtocol") };
        case "empty":
          return { variant: "warning", message: t("discoveryEmpty") };
        case "ai_runtime_unavailable":
          // The real, current state of this stack: no live MCP endpoint to reach. `detail` is
          // the adapter's own explanation, shown as-is rather than paraphrased into a fault.
          return {
            variant: "warning",
            message: t("discoveryRuntimeUnavailable", { detail: result.detail }),
          };
      }
    },
    [t],
  );

  const columns = React.useMemo<ColumnDef<McpServerWithTools, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (row) => row.server.name,
        header: t("columnName"),
        meta: { identifying: true },
      },
      {
        id: "endpoint",
        accessorFn: (row) => row.server.endpoint,
        header: t("columnEndpoint"),
        cell: ({ row }) => <MonoSubLine>{row.original.server.endpoint}</MonoSubLine>,
        meta: { mono: true },
      },
      {
        id: "transport",
        accessorFn: (row) => row.server.transport,
        header: t("columnTransport"),
        cell: ({ row }) => transportLabels[row.original.server.transport],
      },
      {
        id: "authMode",
        accessorFn: (row) => row.server.authMode,
        header: t("columnAuthMode"),
        cell: ({ row }) => authModeLabels[row.original.server.authMode],
      },
      {
        id: "connectionState",
        accessorFn: (row) => row.server.connectionState,
        header: t("columnConnectionState"),
        cell: ({ row }) => (
          <StatusCell
            label={connectionLabel(row.original.server.connectionState)}
            family={CONNECTION_FAMILY[row.original.server.connectionState]}
            rank={CONNECTION_RANK[row.original.server.connectionState]}
          />
        ),
        sortingFn: (a, b) =>
          CONNECTION_RANK[a.original.server.connectionState] -
          CONNECTION_RANK[b.original.server.connectionState],
      },
      {
        id: "toolCount",
        accessorFn: (row) => row.tools.length,
        header: t("columnToolCount"),
        meta: { mono: true },
      },
    ],
    [t, transportLabels, authModeLabels, connectionLabel],
  );

  function onMutationSucceeded(): void {
    setDialog({ kind: "none" });
    setError(null);
    router.refresh();
  }

  async function handleDiscover(row: McpServerWithTools): Promise<void> {
    setDiscoveringId(row.server.id);
    setError(null);
    const result = await actions.connectAndDiscoverMcpServer(row.server.id);
    setDiscoveringId(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOutcomes((current) => ({ ...current, [row.server.id]: describeOutcome(result.value) }));
    // Open the row that was just probed, so the outcome and the (possibly new) tool list are
    // visible without a second click.
    setExpandedIds((current) => new Set([...current, row.server.id]));
    router.refresh();
  }

  async function handleDelete(row: McpServerWithTools): Promise<void> {
    setPending(true);
    const result = await actions.deleteMcpServer(row.server.id);
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

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.server.id}
        getRowLabel={(row) => row.server.name}
        caption={t("heading")}
        captionVisuallyHidden
        savingRowIds={new Set(discoveringId ? [discoveringId] : [])}
        expandable
        expandedIds={expandedIds}
        onExpandedIdsChange={setExpandedIds}
        renderExpandedRow={(row) => (
          <McpServerDetail row={row} outcome={outcomes[row.server.id] ?? null} />
        )}
        renderRowActions={(row) => (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={discoveringId === row.server.id}
              onClick={() => void handleDiscover(row)}
            >
              {t("discoverAction")}
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

      {dialog.kind === "create" ? (
        <McpServerDialog
          title={t("createDialogTitle")}
          submitLabel={t("createDialogSubmit")}
          initial={null}
          transportLabels={transportLabels}
          authModeLabels={authModeLabels}
          pending={pending}
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          onSubmit={async (values) => {
            setPending(true);
            const result = await actions.createMcpServer(values);
            setPending(false);
            if (result.ok) onMutationSucceeded();
            else setError(result.error);
          }}
        />
      ) : null}

      {dialog.kind === "edit" ? (
        <McpServerDialog
          title={t("editDialogTitle")}
          submitLabel={t("editDialogSubmit")}
          initial={dialog.row.server}
          transportLabels={transportLabels}
          authModeLabels={authModeLabels}
          pending={pending}
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          onSubmit={async (values) => {
            setPending(true);
            const result = await actions.updateMcpServer({
              id: dialog.row.server.id,
              ...values,
            });
            setPending(false);
            if (result.ok) onMutationSucceeded();
            else setError(result.error);
          }}
        />
      ) : null}

      {dialog.kind === "delete" ? (
        <DestructiveConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          title={t("deleteConfirmTitle")}
          objectName={dialog.row.server.name}
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

interface McpServerDetailProps {
  readonly row: McpServerWithTools;
  readonly outcome: DiscoveryOutcome | null;
}

/**
 * One server's expanded region: the last discovery outcome, the server's own last error (kept
 * visible rather than buried, since it is what a "Failed" badge is actually about), and every
 * currently-advertised tool as a chip with its own binding count.
 */
function McpServerDetail({ row, outcome }: McpServerDetailProps): React.ReactElement {
  const t = useTranslations("tools.mcpServers");

  return (
    <div className="flex flex-col gap-3">
      {outcome ? <InlineAlert variant={outcome.variant}>{outcome.message}</InlineAlert> : null}

      {row.server.lastError ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">{t("lastErrorLabel")}</span>
          <MonoSubLine>{row.server.lastError}</MonoSubLine>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">{t("discoveredToolsLabel")}</span>
        {row.tools.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noToolsDiscovered")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {row.tools.map((tool) => (
              <li key={tool.id}>
                <Badge
                  variant="neutral"
                  label={t("toolChipLabel", {
                    name: tool.name,
                    count: tool.boundAgentVersionCount,
                  })}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface McpServerDialogProps {
  readonly title: string;
  readonly submitLabel: string;
  /** `null` for a new registration; the existing row when editing. */
  readonly initial: McpServerWithTools["server"] | null;
  readonly transportLabels: Readonly<Record<McpTransport, string>>;
  readonly authModeLabels: Readonly<Record<McpAuthMode, string>>;
  readonly pending: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (values: McpServerFormValues) => Promise<void>;
}

/**
 * One form for both create and edit: `CreateMcpServer` and `UpdateMcpServer` accept exactly the
 * same five fields, so two near-identical dialogs would be duplication with no difference to
 * justify it.
 */
function McpServerDialog({
  title,
  submitLabel,
  initial,
  transportLabels,
  authModeLabels,
  pending,
  onOpenChange,
  onSubmit,
}: McpServerDialogProps) {
  const t = useTranslations("tools.mcpServers");
  const [name, setName] = React.useState(initial?.name ?? "");
  const [endpoint, setEndpoint] = React.useState(initial?.endpoint ?? "");
  const [transport, setTransport] = React.useState<McpTransport>(initial?.transport ?? "Sse");
  const [authMode, setAuthMode] = React.useState<McpAuthMode>(initial?.authMode ?? "None");
  const [credentialSecretRef, setCredentialSecretRef] = React.useState(
    initial?.credentialSecretRef ?? "",
  );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="md" closeLabel={t("closeLabel")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit({
              name,
              endpoint,
              transport,
              authMode,
              credentialSecretRef: trimmedOrNull(credentialSecretRef),
            });
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
          <FormField label={t("fieldEndpoint")} help={t("fieldEndpointHelp")}>
            {(field) => (
              <Input
                {...field}
                dir="ltr"
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                required
              />
            )}
          </FormField>
          <FormField label={t("fieldTransport")}>
            {(field) => (
              <Select
                value={transport}
                onValueChange={(value) => setTransport(value as McpTransport)}
              >
                <SelectTrigger {...field}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MCP_TRANSPORTS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {transportLabels[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label={t("fieldAuthMode")}>
            {(field) => (
              <Select value={authMode} onValueChange={(value) => setAuthMode(value as McpAuthMode)}>
                <SelectTrigger {...field}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MCP_AUTH_MODES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {authModeLabels[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField
            label={t("fieldCredentialSecretRef")}
            labelVariant="optional"
            help={t("fieldCredentialSecretRefHelp")}
          >
            {(field) => (
              <Input
                {...field}
                dir="ltr"
                value={credentialSecretRef}
                onChange={(event) => setCredentialSecretRef(event.target.value)}
              />
            )}
          </FormField>

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
