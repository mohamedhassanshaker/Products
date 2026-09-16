"use client";

/**
 * `/identity` — client half. Two real, working sections (B11 tabs 2 and 4):
 * step-up rules and pending refund requests. Deliberately not a full
 * five-tab reproduction of the B11 wireframe — the identity/payment
 * *mechanism* (the step-up gate, the payment/refund flow, the mock
 * provider's production refusal) is this wave's real scope; provider
 * toggles, gateway method configuration and receipt settings are flagged as
 * deferred UI polish in the review rather than silently reproduced thinly.
 *
 * Both tables are the shared `DataTable` wrapper (design-system.md §5.5
 * #41), not hand-rolled `<table>` markup — the same convention every other
 * backoffice screen (IAM, Agents, Tools, Knowledge, Channels) already
 * follows. Fixed 2026-09-10 as a follow-up to B-8: the original draft
 * predated this wave's `gate:table`/`gate:i18n-strings` gates and hand-rolled
 * both tables with bare English strings.
 */

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { DataTable } from "@/components/patterns/data-table/data-table";
import type { RequiredAssuranceLevel } from "../../../../modules/tools/domain/tool-catalog.js";
import type { StepUpAction } from "../../../../modules/identity/domain/step-up.js";
import type { StepUpRuleRow } from "../../../../modules/identity/ports/step-up-rule-repository.js";
import type { RefundRequestRow } from "../../../../modules/transactions/ports/refund-request-repository.js";
import type { TransactionRow } from "../../../../modules/transactions/ports/transaction-repository.js";
import type { ActionResult } from "./actions.js";

const REQUIRED_ASSURANCE_LEVELS: readonly RequiredAssuranceLevel[] = [
  "Anonymous",
  "Verified",
  "VerifiedPlusOtp",
  "VerifiedPlusDocument",
];

export interface IdentityScreenProps {
  readonly stepUpRules: readonly StepUpRuleRow[];
  readonly pendingRefunds: readonly RefundRequestRow[];
  readonly transactionsById: ReadonlyMap<string, TransactionRow>;
  readonly accountOwnershipCheckEnabled: boolean;
  readonly actions: {
    readonly setStepUpRule: (
      actionKey: StepUpAction,
      requiredAssurance: RequiredAssuranceLevel,
    ) => Promise<ActionResult<{ readonly ok: boolean; readonly reason?: string }>>;
    readonly approveRefund: (
      refundRequestId: string,
    ) => Promise<ActionResult<{ readonly ok: boolean; readonly reason?: string }>>;
    readonly declineRefund: (
      refundRequestId: string,
      reason: string,
    ) => Promise<ActionResult<{ readonly ok: boolean; readonly reason?: string }>>;
  };
}

export function IdentityScreen(props: IdentityScreenProps) {
  const t = useTranslations("identity");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function runAction(promise: Promise<ActionResult<{ ok: boolean; reason?: string }>>): void {
    startTransition(async () => {
      const result = await promise;
      if (!result.ok) {
        setMessage(result.error);
      } else if (!result.value.ok) {
        setMessage(result.value.reason ?? t("actionRefusedError"));
      } else {
        setMessage(null);
      }
    });
  }

  const stepUpColumns = useMemo<ColumnDef<StepUpRuleRow, unknown>[]>(
    () => [
      {
        id: "action",
        accessorKey: "actionKey",
        header: t("stepUpRules.columnAction"),
        meta: { identifying: true },
      },
      {
        id: "requiredAssurance",
        accessorKey: "requiredAssurance",
        header: t("stepUpRules.columnRequiredAssurance"),
      },
      {
        id: "change",
        header: t("stepUpRules.columnChange"),
        cell: ({ row }) => (
          <select
            disabled={pending}
            defaultValue={row.original.requiredAssurance}
            aria-label={t("stepUpRules.requiredAssuranceLabel", { action: row.original.actionKey })}
            onChange={(event) =>
              runAction(
                props.actions.setStepUpRule(
                  row.original.actionKey,
                  event.target.value as RequiredAssuranceLevel,
                ),
              )
            }
            className="rounded border bg-background px-2 py-1"
          >
            {REQUIRED_ASSURANCE_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        ),
      },
    ],
    // (No `react-hooks/exhaustive-deps` rule is configured in this project — see
    // `iam/roles-tab.tsx`'s identical note — so no disable directive is needed here.)
    [t, pending, props.actions],
  );

  const refundColumns = useMemo<ColumnDef<RefundRequestRow, unknown>[]>(
    () => [
      {
        id: "transaction",
        accessorFn: (row) =>
          props.transactionsById.get(row.transactionId)?.reference ?? row.transactionId,
        header: t("refunds.columnTransaction"),
        meta: { identifying: true },
      },
      {
        id: "amount",
        accessorFn: (row) => Number(row.amountMinor) / 100,
        header: t("refunds.columnAmount"),
        cell: ({ row }) => {
          const transaction = props.transactionsById.get(row.original.transactionId);
          return `${(Number(row.original.amountMinor) / 100).toFixed(2)} ${transaction?.amount.currency ?? "AED"}`;
        },
      },
      {
        id: "reason",
        accessorKey: "reason",
        header: t("refunds.columnReason"),
      },
      {
        id: "decision",
        header: t("refunds.columnDecision"),
        cell: ({ row }) => (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              loading={pending}
              onClick={() => runAction(props.actions.approveRefund(row.original.id))}
            >
              {t("refunds.approveAction")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={pending}
              onClick={() =>
                runAction(props.actions.declineRefund(row.original.id, "Declined by back office"))
              }
            >
              {t("refunds.declineAction")}
            </Button>
          </div>
        ),
      },
    ],
    // Same "no exhaustive-deps rule configured" note as `stepUpColumns` above.
    [t, pending, props.actions, props.transactionsById],
  );

  return (
    <div className="flex flex-col gap-8">
      {message && <InlineAlert variant="destructive">{message}</InlineAlert>}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-foreground">{t("stepUpRules.heading")}</h2>
        <DataTable
          columns={stepUpColumns}
          data={props.stepUpRules}
          getRowId={(row) => row.actionKey}
          getRowLabel={(row) => row.actionKey}
          caption={t("stepUpRules.heading")}
          captionVisuallyHidden
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-foreground">{t("accountOwnership.heading")}</h2>
        <p className="text-sm text-muted-foreground">
          {props.accountOwnershipCheckEnabled
            ? t("accountOwnership.enabled")
            : t("accountOwnership.disabled")}
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-foreground">{t("refunds.heading")}</h2>
        {props.pendingRefunds.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("refunds.empty")}</p>
        ) : (
          <DataTable
            columns={refundColumns}
            data={props.pendingRefunds}
            getRowId={(row) => row.id}
            getRowLabel={(row) =>
              props.transactionsById.get(row.transactionId)?.reference ?? row.id
            }
            caption={t("refunds.heading")}
            captionVisuallyHidden
          />
        )}
      </section>
    </div>
  );
}
