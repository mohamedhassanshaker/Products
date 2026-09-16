"use client";

/**
 * B2 — Agent registry. A real `DataTable` (never a hand-rolled `<table>`), row actions in a
 * `DropdownMenu` (Clone/Publish/Unpublish/Archive/Roll back/Version history) since a single
 * row can carry up to six actions depending on its status — too many for `iam/users-tab.tsx`'s
 * inline-button-row pattern to stay legible.
 */

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { StatusCell } from "@/components/ui/status-cell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable } from "@/components/patterns/data-table/data-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DestructiveConfirmDialog,
} from "@/components/patterns/dialog";
import type {
  AgentRegistryRow,
  AgentVersionSummary,
} from "../../../../modules/agents/ports/agent-repository.js";
import type { AgentStatus } from "../../../../modules/agents/domain/agent.js";
import type {
  archiveAgentAction,
  cloneAgentAction,
  loadVersionHistoryAction,
  publishAgentVersionAction,
  rollbackAgentVersionAction,
  unpublishAgentAction,
} from "./actions.js";

export interface AgentsScreenActions {
  readonly cloneAgent: typeof cloneAgentAction;
  readonly publishAgentVersion: typeof publishAgentVersionAction;
  readonly unpublishAgent: typeof unpublishAgentAction;
  readonly archiveAgent: typeof archiveAgentAction;
  readonly rollbackAgentVersion: typeof rollbackAgentVersionAction;
  readonly loadVersionHistory: typeof loadVersionHistoryAction;
}

export interface AgentsScreenProps {
  readonly rows: readonly AgentRegistryRow[];
  readonly canPublish: boolean;
  readonly actions: AgentsScreenActions;
}

/** Rank order for `StatusCell`'s sort (never alphabetical) — Published first, the state B2 is mostly used to confirm. */
const STATUS_RANK: Record<AgentStatus, number> = { Published: 0, Draft: 1, Archived: 2 };
const STATUS_FAMILY: Record<AgentStatus, "success" | "info" | "destructive"> = {
  Published: "success",
  Draft: "info",
  Archived: "destructive",
};

type DialogState =
  | { readonly kind: "none" }
  | { readonly kind: "publish"; readonly row: AgentRegistryRow }
  | { readonly kind: "archive"; readonly row: AgentRegistryRow }
  | { readonly kind: "history"; readonly row: AgentRegistryRow };

export function AgentsScreen({ rows, canPublish, actions }: AgentsScreenProps): React.ReactElement {
  const t = useTranslations("agents.registry");
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const [dialog, setDialog] = React.useState<DialogState>({ kind: "none" });
  const [pendingRowId, setPendingRowId] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  function statusLabel(status: AgentStatus): string {
    return status === "Published"
      ? t("statusPublished")
      : status === "Draft"
        ? t("statusDraft")
        : t("statusArchived");
  }

  async function withPending(
    row: AgentRegistryRow,
    fn: () => Promise<{ ok: boolean; reason?: string }>,
  ) {
    setPendingRowId(row.id);
    setRowError(null);
    const result = await fn();
    setPendingRowId(null);
    if (!result.ok) {
      setRowError(
        t(`reason.${result.reason}`, { defaultValue: result.reason ?? t("genericError") }),
      );
    } else {
      router.refresh();
    }
  }

  const columns = React.useMemo<ColumnDef<AgentRegistryRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: t("columnAgent"),
        meta: { identifying: true },
        cell: ({ row }) => (
          <Link
            href={`agents/${row.original.id}/edit`}
            className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "version",
        accessorKey: "currentVersionLabel",
        header: t("columnVersion"),
        meta: { mono: true },
        cell: ({ row }) => row.original.currentVersionLabel ?? t("noVersion"),
      },
      {
        id: "status",
        accessorKey: "status",
        header: t("columnStatus"),
        cell: ({ row }) => (
          <StatusCell
            label={statusLabel(row.original.status)}
            family={STATUS_FAMILY[row.original.status]}
            rank={STATUS_RANK[row.original.status]}
          />
        ),
        sortingFn: (a, b) => STATUS_RANK[a.original.status] - STATUS_RANK[b.original.status],
      },
      {
        id: "channels",
        accessorFn: (row) => row.enabledChannelKeys.join(", "),
        header: t("columnChannels"),
        cell: ({ row }) =>
          row.original.enabledChannelKeys.length > 0
            ? row.original.enabledChannelKeys.map((key) => t(`channel.${key}`)).join(", ")
            : t("noChannels"),
      },
      {
        id: "usage",
        accessorKey: "usagePerDay",
        header: t("columnUsage"),
        meta: { mono: true },
        cell: ({ row }) =>
          row.original.usagePerDay === null
            ? t("noUsage")
            : t("usagePerDay", { count: row.original.usagePerDay }),
      },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">{t("heading")}</h2>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="agents/new-with-ai">{t("createWithAiAction")}</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="agents/new">{t("newAgentAction")}</Link>
          </Button>
        </div>
      </div>

      {rowError ? <InlineAlert variant="destructive">{rowError}</InlineAlert> : null}

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.name}
        caption={t("heading")}
        captionVisuallyHidden
        savingRowIds={new Set(pendingRowId ? [pendingRowId] : [])}
        emptyContent={<p className="p-4 text-sm text-muted-foreground">{t("emptyState")}</p>}
        status={rows.length === 0 ? "empty" : "ready"}
        renderRowActions={(row) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" disabled={pendingRowId === row.id}>
                {t("rowActionsLabel")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => router.push(`/${locale}/agents/${row.id}/edit`)}>
                {t("editAction")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => void withPending(row, () => actions.cloneAgent(row.id))}
              >
                {t("cloneAction")}
              </DropdownMenuItem>
              {row.status !== "Published" && canPublish && row.currentVersionId ? (
                <DropdownMenuItem onSelect={() => setDialog({ kind: "publish", row })}>
                  {t("publishAction")}
                </DropdownMenuItem>
              ) : null}
              {row.status === "Published" && canPublish ? (
                <DropdownMenuItem
                  onSelect={() => void withPending(row, () => actions.unpublishAgent(row.id))}
                >
                  {t("unpublishAction")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => setDialog({ kind: "history", row })}>
                {t("historyAction")}
              </DropdownMenuItem>
              {row.status !== "Archived" ? (
                <DropdownMenuItem onSelect={() => setDialog({ kind: "archive", row })}>
                  {t("archiveAction")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      {dialog.kind === "publish" ? (
        <PublishDialog
          row={dialog.row}
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          onPublish={async (changeSummary) => {
            const result = await actions.publishAgentVersion({
              agentId: dialog.row.id,
              agentVersionId: dialog.row.currentVersionId ?? "",
              changeSummary,
            });
            if (result.ok) {
              setDialog({ kind: "none" });
              router.refresh();
            } else {
              setRowError(t(`reason.${result.reason}`, { defaultValue: result.reason }));
            }
          }}
          t={t}
        />
      ) : null}

      {dialog.kind === "archive" ? (
        <DestructiveConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          title={t("archiveConfirmTitle")}
          objectName={dialog.row.name}
          descriptionTemplate={(name) => t("archiveConfirmDescription", { name })}
          actionLabel={t("archiveConfirmAction")}
          cancelLabel={t("cancel")}
          confirming={pendingRowId === dialog.row.id}
          onConfirm={async () => {
            const row = dialog.row;
            setPendingRowId(row.id);
            const result = await actions.archiveAgent(row.id);
            setPendingRowId(null);
            if (result.ok) {
              setDialog({ kind: "none" });
              router.refresh();
            } else {
              setRowError(t(`reason.${result.reason}`, { defaultValue: result.reason }));
            }
          }}
        />
      ) : null}

      {dialog.kind === "history" ? (
        <HistoryDialog
          row={dialog.row}
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          loadVersionHistory={actions.loadVersionHistory}
          onRollback={async (targetVersionId) => {
            const result = await actions.rollbackAgentVersion({
              agentId: dialog.row.id,
              targetVersionId,
            });
            if (result.ok) {
              setDialog({ kind: "none" });
              router.refresh();
            } else {
              setRowError(t(`reason.${result.reason}`, { defaultValue: result.reason }));
            }
          }}
          t={t}
        />
      ) : null}
    </div>
  );
}

interface PublishDialogProps {
  readonly row: AgentRegistryRow;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPublish: (changeSummary: string | null) => Promise<void>;
  readonly t: ReturnType<typeof useTranslations>;
}

function PublishDialog({ row, onOpenChange, onPublish, t }: PublishDialogProps) {
  const [changeSummary, setChangeSummary] = React.useState("");
  const [pending, setPending] = React.useState(false);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t("publishDialogTitle", { name: row.name })}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setPending(true);
            void onPublish(changeSummary.trim().length > 0 ? changeSummary.trim() : null).finally(
              () => setPending(false),
            );
          }}
        >
          <FormField label={t("publishDialogChangeSummaryLabel")}>
            {(field) => (
              <Input
                {...field}
                value={changeSummary}
                onChange={(event) => setChangeSummary(event.target.value)}
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
              {t("publishDialogSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface HistoryDialogProps {
  readonly row: AgentRegistryRow;
  readonly onOpenChange: (open: boolean) => void;
  readonly loadVersionHistory: typeof loadVersionHistoryAction;
  readonly onRollback: (targetVersionId: string) => Promise<void>;
  readonly t: ReturnType<typeof useTranslations>;
}

function HistoryDialog({
  row,
  onOpenChange,
  loadVersionHistory,
  onRollback,
  t,
}: HistoryDialogProps) {
  type HistoryState =
    | { readonly kind: "loading" }
    | { readonly kind: "error"; readonly error: string }
    | { readonly kind: "ok"; readonly versions: readonly AgentVersionSummary[] };
  const [state, setState] = React.useState<HistoryState>({ kind: "loading" });
  const [rollingBackId, setRollingBackId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void loadVersionHistory(row.id).then((result) => {
      if (cancelled) return;
      if (result.ok) setState({ kind: "ok", versions: result.value.versions });
      else setState({ kind: "error", error: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [row.id, loadVersionHistory]);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t("historyDialogTitle", { name: row.name })}</DialogTitle>
        </DialogHeader>
        {state.kind === "loading" ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : null}
        {state.kind === "error" ? (
          <InlineAlert variant="destructive">{state.error}</InlineAlert>
        ) : null}
        {state.kind === "ok" ? (
          <ul className="flex flex-col gap-3">
            {state.versions.map((version) => (
              <li
                key={version.id}
                className="flex items-center justify-between gap-3 border-b border-border pb-2"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-sm text-foreground">{version.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {version.changeSummary ?? t("noChangeSummary")}
                  </span>
                </div>
                {!version.isCurrent ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={rollingBackId === version.id}
                    onClick={async () => {
                      setRollingBackId(version.id);
                      await onRollback(version.id);
                      setRollingBackId(null);
                    }}
                  >
                    {t("rollbackAction")}
                  </Button>
                ) : (
                  <span className="text-xs font-medium text-success">
                    {t("currentVersionLabel")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
