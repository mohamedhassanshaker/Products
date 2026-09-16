"use client";

/** B14 tab 2 — the append-only audit log. `[rule]`: entries cannot be edited or deleted
 *  by any role, including Super Admin — this tab is read-only by construction (no
 *  edit/delete action exists anywhere in this file, matching `AuditLogRepository`'s own
 *  read-only port). */
import * as React from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { DataTable } from "@/components/patterns/data-table/data-table";
import type { ColumnDef } from "@tanstack/react-table";
import type {
  AuditLogEntryRow,
  AuditLogPage,
} from "../../../../modules/governance/ports/audit-log-repository.js";
import type { GovernanceScreenActions } from "./governance-screen.js";

export interface AuditLogTabProps {
  readonly initialPage: AuditLogPage;
  readonly actions: GovernanceScreenActions;
}

export function AuditLogTab({ initialPage, actions }: AuditLogTabProps): React.ReactElement {
  const t = useTranslations("governance.auditLog");

  const [items, setItems] = React.useState(initialPage.items);
  const [nextCursor, setNextCursor] = React.useState(initialPage.nextCursor);
  const [selected, setSelected] = React.useState<AuditLogEntryRow | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setItems(initialPage.items);
    setNextCursor(initialPage.nextCursor);
  }, [initialPage]);

  async function handleLoadMore(): Promise<void> {
    if (!nextCursor) return;
    setError(null);
    setBusy(true);
    const result = await actions.listAuditLog({ cursor: nextCursor, limit: 50 });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setItems((rows) => [...rows, ...result.value.items]);
    setNextCursor(result.value.nextCursor);
  }

  async function handleSelect(id: string): Promise<void> {
    setError(null);
    const result = await actions.getAuditEntry(id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSelected(result.value);
  }

  const columns = React.useMemo<ColumnDef<AuditLogEntryRow, unknown>[]>(
    () => [
      {
        id: "actorDisplayNameSnapshot",
        accessorKey: "actorDisplayNameSnapshot",
        header: t("columnWho"),
        meta: { identifying: true },
        cell: ({ row }) => (
          <Button variant="link" size="sm" onClick={() => void handleSelect(row.original.id)}>
            {row.original.actorDisplayNameSnapshot}
          </Button>
        ),
      },
      { id: "summary", accessorKey: "summary", header: t("columnWhat") },
      { id: "environmentKey", accessorKey: "environmentKey", header: t("columnEnvironment") },
      {
        id: "occurredAt",
        accessorKey: "occurredAt",
        header: t("columnWhen"),
        meta: { mono: true },
        cell: ({ row }) => row.original.occurredAt.toLocaleString(),
      },
    ],
    [t],
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-3 lg:col-span-2">
        {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
        <Card className="flex flex-col gap-3 p-4">
          <DataTable<AuditLogEntryRow>
            columns={columns}
            data={items}
            getRowId={(row) => row.id}
            caption={t("caption")}
            status={items.length === 0 ? "empty" : "ready"}
            emptyContent={<EmptyState headline={t("emptyHeadline")} cause={t("emptyCause")} />}
            footer={
              nextCursor ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleLoadMore()}
                >
                  {t("loadMoreAction")}
                </Button>
              ) : undefined
            }
          />
        </Card>
      </div>

      <div>
        {selected ? (
          <Card className="flex flex-col gap-2 p-4 text-sm">
            <p className="font-medium text-foreground">{selected.summary}</p>
            <p className="text-muted-foreground">
              {t("detailActor", { actor: selected.actorDisplayNameSnapshot })}
            </p>
            <p className="text-muted-foreground">
              {t("detailAction", { action: selected.action })}
            </p>
            <p className="text-muted-foreground">
              {t("detailTarget", {
                target: `${selected.targetKind} — ${selected.targetLabelSnapshot}`,
              })}
            </p>
            {selected.beforeJson ? (
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                {selected.beforeJson}
              </pre>
            ) : null}
            {selected.afterJson ? (
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                {selected.afterJson}
              </pre>
            ) : null}
          </Card>
        ) : (
          <Card className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
            {t("selectAPrompt")}
          </Card>
        )}
      </div>
    </div>
  );
}
