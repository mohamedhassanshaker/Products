"use client";

/**
 * Screen 3, "Per-agent overrides" tab (wireframe `#screen-guardrails`, subtab
 * `overrides`) — READ-ONLY, per the task brief: "linking to the real agent to actually
 * change it there — do not rebuild the writable per-agent toggle here, that already
 * exists and belongs to the agent." No dialog, no action button that writes anything;
 * the only interactive element is a link to the agent's own editor.
 *
 * ## Why the link targets the wizard's entry route, not a "step 7" deep link
 *
 * `wizard-shell.tsx` (`agents/[id]/edit`) owns `activeStepId` as plain component state
 * (`React.useState<WizardStepId>`), never a URL search param — confirmed by reading that
 * file directly rather than assumed, matching this project's own "verify a route exists
 * before linking to it" discipline. There is no `?step=guardrails` (or any other) URL this
 * app's own routing recognises, so `/agents/[id]/edit` — the real, correct entry point,
 * where a Designer lands on whichever step the wizard's own state resolves — is the
 * nearest real deep link this app supports, not a step-scoped shortcut this screen would
 * have to invent.
 */
import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MonoSubLine } from "@/components/ui/mono-sub-line";
import { DataTable } from "@/components/patterns/data-table/data-table";
import type { PolicyOverrideDirectoryRow } from "../../../../modules/guardrails/ports/policy-override-directory-repository.js";

/** No `actions` prop: this tab is read-only end to end (task brief) — it renders only the
 *  server-loaded list, and the only interactive element is a link to the agent's own
 *  wizard, which owns the real write path and its own `router.refresh()`. */
export interface PolicyOverridesTabProps {
  readonly initialOverrides: readonly PolicyOverrideDirectoryRow[];
  readonly locale: string;
}

export function PolicyOverridesTab({
  initialOverrides,
  locale,
}: PolicyOverridesTabProps): React.ReactElement {
  const t = useTranslations("guardrails.overrides");

  function valueDisplay(row: PolicyOverrideDirectoryRow): string {
    if (row.mode === "Disabled") return t("modeDisabled");
    return row.valueJson ?? t("modeDisabled");
  }

  const columns = React.useMemo<ColumnDef<PolicyOverrideDirectoryRow, unknown>[]>(
    () => [
      {
        id: "policyKey",
        accessorKey: "policyKey",
        header: t("columnPolicy"),
        meta: { identifying: true, mono: true },
      },
      {
        id: "agentName",
        accessorKey: "agentName",
        header: t("columnAgent"),
        cell: ({ row }) => (
          <Link
            href={`/${locale}/agents/${row.original.agentId}/edit`}
            className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
          >
            {row.original.agentName}
          </Link>
        ),
      },
      {
        id: "mode",
        accessorKey: "mode",
        header: t("columnMode"),
        cell: ({ row }) =>
          row.original.mode === "Disabled" ? t("modeDisabledLabel") : t("modeValueLabel"),
      },
      {
        id: "value",
        header: t("columnValue"),
        cell: ({ row }) => <MonoSubLine>{valueDisplay(row.original)}</MonoSubLine>,
      },
      {
        id: "reason",
        accessorKey: "reason",
        header: t("columnReason"),
      },
    ],
    [locale, t],
  );

  return (
    <Card className="flex flex-col gap-3 p-4">
      <DataTable<PolicyOverrideDirectoryRow>
        columns={columns}
        data={initialOverrides}
        getRowId={(row) => row.id}
        getRowLabel={(row) => `${row.agentName} — ${row.policyKey}`}
        caption={t("caption")}
        captionVisuallyHidden
        status={initialOverrides.length === 0 ? "empty" : "ready"}
        emptyContent={<EmptyState headline={t("emptyHeadline")} cause={t("emptyCause")} />}
      />
    </Card>
  );
}
