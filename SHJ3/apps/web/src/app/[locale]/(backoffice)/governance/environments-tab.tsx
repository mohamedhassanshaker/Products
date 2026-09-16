"use client";

/**
 * B14 tab 1 — Environments & promotions.
 *
 * `[rule]`: approving or rejecting a pending promotion removes it from this list AND
 * writes an audit entry in real time — trivially true here since it is the SAME atomic
 * DB write (`TR_PromotionRequests_decisionRules`): `router.refresh()` after either action
 * re-pulls both this tab's pending list and the audit log tab's entries from the same
 * already-committed transaction, never a separate follow-up write.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { DataTable } from "@/components/patterns/data-table/data-table";
import type { ColumnDef } from "@tanstack/react-table";
import type { EnvironmentRow } from "../../../../modules/governance/ports/environment-repository.js";
import type { PromotionRequestRow } from "../../../../modules/governance/ports/promotion-repository.js";
import type { GovernanceScreenActions } from "./governance-screen.js";

export interface EnvironmentsTabProps {
  readonly initialEnvironments: readonly EnvironmentRow[];
  readonly initialPendingPromotions: readonly PromotionRequestRow[];
  readonly actions: GovernanceScreenActions;
}

export function EnvironmentsTab({
  initialEnvironments,
  initialPendingPromotions,
  actions,
}: EnvironmentsTabProps): React.ReactElement {
  const t = useTranslations("governance.environments");
  const router = useRouter();

  const [environments, setEnvironments] = React.useState(initialEnvironments);
  const [pending, setPending] = React.useState(initialPendingPromotions);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  React.useEffect(() => setEnvironments(initialEnvironments), [initialEnvironments]);
  React.useEffect(() => setPending(initialPendingPromotions), [initialPendingPromotions]);

  async function handleApprove(id: string): Promise<void> {
    setError(null);
    setBusyId(id);
    const result = await actions.approvePromotion(id);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPending((rows) => rows.filter((row) => row.id !== id));
    router.refresh();
  }

  async function handleReject(id: string): Promise<void> {
    setError(null);
    setBusyId(id);
    const result = await actions.rejectPromotion(id, t("defaultRejectionNote"));
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPending((rows) => rows.filter((row) => row.id !== id));
    router.refresh();
  }

  const environmentColumns = React.useMemo<ColumnDef<EnvironmentRow, unknown>[]>(
    () => [
      {
        id: "displayName",
        accessorKey: "displayName",
        header: t("columnEnvironment"),
        meta: { identifying: true },
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span>{row.original.displayName}</span>
            {row.original.isLive ? <Badge variant="outline" label={t("liveBadge")} /> : null}
          </div>
        ),
      },
      {
        id: "agentCount",
        accessorKey: "agentCount",
        header: t("columnAgents"),
        meta: { mono: true },
      },
      {
        id: "deployedVersionLabels",
        accessorKey: "deployedVersionLabels",
        header: t("columnVersions"),
        cell: ({ row }) =>
          row.original.deployedVersionLabels.length > 0
            ? row.original.deployedVersionLabels.join(" / ")
            : t("noVersionsDeployed"),
      },
      {
        id: "promotesToKey",
        accessorKey: "promotesToKey",
        header: t("columnPromotesTo"),
        cell: ({ row }) =>
          row.original.promotesToKey
            ? (environments.find((environment) => environment.key === row.original.promotesToKey)
                ?.displayName ?? row.original.promotesToKey)
            : t("noPromotionTarget"),
      },
    ],
    [environments, t],
  );

  const pendingColumns = React.useMemo<ColumnDef<PromotionRequestRow, unknown>[]>(
    () => [
      {
        id: "change",
        accessorKey: "agentName",
        header: t("columnChange"),
        meta: { identifying: true },
        cell: ({ row }) => (
          <span>
            {row.original.agentName} {row.original.versionLabel}
          </span>
        ),
      },
      {
        id: "path",
        header: t("columnPath"),
        cell: ({ row }) =>
          `${environments.find((environment) => environment.key === row.original.fromEnvironmentKey)?.displayName ?? row.original.fromEnvironmentKey} → ${environments.find((environment) => environment.key === row.original.toEnvironmentKey)?.displayName ?? row.original.toEnvironmentKey}`,
      },
      {
        id: "requestedByStaffUserId",
        accessorKey: "requestedByStaffUserId",
        header: t("columnRequester"),
      },
      { id: "status", accessorKey: "status", header: t("columnStatus") },
    ],
    [environments, t],
  );

  return (
    <div className="flex flex-col gap-6">
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold text-foreground">{t("environmentsHeading")}</h2>
        <DataTable<EnvironmentRow>
          columns={environmentColumns}
          data={environments}
          getRowId={(row) => row.key}
          caption={t("environmentsCaption")}
          status={environments.length === 0 ? "empty" : "ready"}
          emptyContent={
            <EmptyState
              headline={t("environmentsEmptyHeadline")}
              cause={t("environmentsEmptyCause")}
            />
          }
        />
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold text-foreground">{t("pendingHeading")}</h2>
        <DataTable<PromotionRequestRow>
          columns={pendingColumns}
          data={pending}
          getRowId={(row) => row.id}
          caption={t("pendingCaption")}
          status={pending.length === 0 ? "empty" : "ready"}
          emptyContent={
            <EmptyState headline={t("pendingEmptyHeadline")} cause={t("pendingEmptyCause")} />
          }
          renderRowActions={(row) => (
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busyId === row.id}
                onClick={() => void handleReject(row.id)}
              >
                {t("rejectAction")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busyId === row.id}
                onClick={() => void handleApprove(row.id)}
              >
                {t("approveAction")}
              </Button>
            </div>
          )}
        />
      </Card>
    </div>
  );
}
