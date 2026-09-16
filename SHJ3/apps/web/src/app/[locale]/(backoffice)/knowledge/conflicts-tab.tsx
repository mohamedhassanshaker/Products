"use client";

/**
 * B6 tab 4 — source conflicts (FR-KNOW-18..22). This wave's scope is real CRUD +
 * resolution semantics + grounding-penalty display over seeded/already-detected rows —
 * conflict *detection* during ingestion is not built this pass (see the knowledge route's
 * own module comment / this wave's final report). A human choosing a side via **Make
 * authoritative** is always allowed regardless of the tenant's default policy
 * (FR-KNOW-20/22); the policy selector below only sets what a *future* automatic-
 * resolution mechanism would consult.
 */

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
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
  CONFLICT_POLICIES,
  type ConflictPolicy,
  type ConflictStatus,
} from "../../../../modules/knowledge/domain/knowledge-catalog.js";
import type { SourceConflictRow } from "../../../../modules/knowledge/ports/conflict-repository.js";
import type { KnowledgeScreenActions } from "./knowledge-screen.js";

export interface ConflictsTabProps {
  readonly rows: readonly SourceConflictRow[];
  readonly defaultConflictPolicy: ConflictPolicy;
  readonly actions: KnowledgeScreenActions;
}

const STATUS_FAMILY: Readonly<Record<ConflictStatus, StatusFamily>> = {
  Open: "warning",
  Resolved: "success",
  Ignored: "neutral",
};

/** Sort rank for the status column (design-system.md §5.4 #39 — never alphabetical): Open conflicts need attention first. */
const STATUS_RANK: Readonly<Record<ConflictStatus, number>> = {
  Open: 0,
  Resolved: 1,
  Ignored: 2,
};

export function ConflictsTab({
  rows,
  defaultConflictPolicy,
  actions,
}: ConflictsTabProps): React.ReactElement {
  const t = useTranslations("knowledge.conflicts");
  const locale = useLocale();
  const router = useRouter();
  const [policy, setPolicy] = React.useState(defaultConflictPolicy);
  const [policyPending, setPolicyPending] = React.useState(false);
  const [resolvingId, setResolvingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const dateFormatter = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    [locale],
  );

  async function handlePolicyChange(next: ConflictPolicy): Promise<void> {
    setPolicy(next);
    setPolicyPending(true);
    const result = await actions.updateDefaultConflictPolicy(next);
    setPolicyPending(false);
    if (!result.ok || !result.value.ok) {
      setError(!result.ok ? result.error : t("policySaveError"));
      setPolicy(defaultConflictPolicy);
      return;
    }
    router.refresh();
  }

  async function handleResolve(row: SourceConflictRow, side: "A" | "B"): Promise<void> {
    setResolvingId(row.id);
    const result = await actions.resolveConflict({ conflictId: row.id, authoritativeSide: side });
    setResolvingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.value.ok) {
      setError(t(`resolveError.${result.value.reason}`));
      return;
    }
    router.refresh();
  }

  const columns = React.useMemo<ColumnDef<SourceConflictRow, unknown>[]>(
    () => [
      { id: "topic", accessorKey: "topic", header: t("columnTopic"), meta: { identifying: true } },
      {
        id: "sideA",
        accessorFn: (row) => row.sideAValue,
        header: t("columnSideA"),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span>{row.original.sideAValue}</span>
            <span className="text-2xs text-muted-foreground">
              {t("sourceAndDate", {
                source: row.original.sideAKnowledgeSourceName,
                date: dateFormatter.format(row.original.sideASourceUpdatedAt),
              })}
            </span>
          </div>
        ),
      },
      {
        id: "sideB",
        accessorFn: (row) => row.sideBValue,
        header: t("columnSideB"),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span>{row.original.sideBValue}</span>
            <span className="text-2xs text-muted-foreground">
              {t("sourceAndDate", {
                source: row.original.sideBKnowledgeSourceName,
                date: dateFormatter.format(row.original.sideBSourceUpdatedAt),
              })}
            </span>
          </div>
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        header: t("columnStatus"),
        cell: ({ row }) => (
          <StatusCell
            label={
              row.original.status === "Resolved" && row.original.authoritativeSide
                ? t("statusResolvedWithSide", { side: row.original.authoritativeSide })
                : t(`status.${row.original.status}`)
            }
            family={STATUS_FAMILY[row.original.status]}
            rank={STATUS_RANK[row.original.status]}
          />
        ),
      },
    ],
    [t, dateFormatter],
  );

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-medium text-foreground">{t("heading")}</h2>
      <FormField label={t("fieldDefaultPolicy")} help={t("fieldDefaultPolicyHelp")}>
        {(field) => (
          <Select
            value={policy}
            onValueChange={(value) => void handlePolicyChange(value as ConflictPolicy)}
          >
            <SelectTrigger {...field} disabled={policyPending}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONFLICT_POLICIES.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`policy.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>

      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.topic}
        caption={t("heading")}
        captionVisuallyHidden
        renderRowActions={(row) =>
          row.status === "Open" ? (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={resolvingId === row.id}
                onClick={() => void handleResolve(row, "A")}
              >
                {t("makeAuthoritativeAAction")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={resolvingId === row.id}
                onClick={() => void handleResolve(row, "B")}
              >
                {t("makeAuthoritativeBAction")}
              </Button>
            </div>
          ) : null
        }
      />
    </div>
  );
}
