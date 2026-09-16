"use client";

/** B1 tab 1 — Overview. Date-range control drives the channel-split/top-intents panels;
 *  the KPI grid itself always shows all three ranges side by side, matching the
 *  wireframe's own three-column table (see `GetOverviewMetrics`'s own doc comment for
 *  why). */
import * as React from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Card } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { DateRangeToggle } from "@/components/ui/date-range-toggle";
import { DataTable } from "@/components/patterns/data-table/data-table";
import {
  DATE_RANGE_KEYS,
  type DateRangeKey,
} from "../../../../modules/analytics/domain/date-range.js";
import type { OverviewMetricsResult } from "../../../../modules/analytics/application/get-overview-metrics.js";
import type { CommandCentreScreenActions } from "./command-centre-screen.js";

export interface OverviewTabProps {
  readonly initialOverview: OverviewMetricsResult;
  readonly actions: CommandCentreScreenActions;
}

function formatPercent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 1000) / 10}%`;
}

const KPI_ROWS: readonly {
  readonly key: "conversationCount" | "containmentRate" | "deflectionRate" | "toolErrorRate";
  readonly labelKey: "conversations" | "containmentRate" | "deflectionRate" | "toolErrorRate";
  readonly isRate: boolean;
}[] = [
  { key: "conversationCount", labelKey: "conversations", isRate: false },
  { key: "containmentRate", labelKey: "containmentRate", isRate: true },
  { key: "deflectionRate", labelKey: "deflectionRate", isRate: true },
  { key: "toolErrorRate", labelKey: "toolErrorRate", isRate: true },
];

/** One pivoted row per metric — design-system.md §5.5 #41 requires every table in the app
 *  to go through `DataTable`, including a metric-by-date-range grid like this one: rows are
 *  metrics, one column per date range, exactly the KPI grid's own shape. */
interface KpiTableRow {
  readonly key: (typeof KPI_ROWS)[number]["key"];
  readonly label: string;
  readonly values: Readonly<Record<DateRangeKey, string>>;
}

export function OverviewTab({ initialOverview, actions }: OverviewTabProps): React.ReactElement {
  const t = useTranslations("commandCentre.overview");
  const [overview, setOverview] = React.useState(initialOverview);
  const [dateRange, setDateRange] = React.useState<DateRangeKey>("Today");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleRangeChange(value: string): Promise<void> {
    const range = value as DateRangeKey;
    setDateRange(range);
    setLoading(true);
    setError(null);
    const result = await actions.getOverviewMetrics(range);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOverview(result.value);
  }

  const kpiRows = React.useMemo<readonly KpiTableRow[]>(
    () =>
      KPI_ROWS.map((row) => ({
        key: row.key,
        label: t(`metrics.${row.labelKey}`),
        values: Object.fromEntries(
          DATE_RANGE_KEYS.map((rangeKey) => {
            const kpi = overview.kpiGrid[rangeKey];
            const value = row.isRate
              ? formatPercent(kpi[row.key as "containmentRate"])
              : kpi.conversationCount.toLocaleString();
            return [rangeKey, value];
          }),
        ) as Record<DateRangeKey, string>,
      })),
    [overview, t],
  );

  const kpiColumns = React.useMemo<ColumnDef<KpiTableRow, unknown>[]>(
    () => [
      {
        id: "label",
        accessorKey: "label",
        header: t("metricColumn"),
        meta: { identifying: true },
      },
      ...DATE_RANGE_KEYS.map((rangeKey): ColumnDef<KpiTableRow, unknown> => ({
        id: rangeKey,
        header: t(`ranges.${rangeKey}`),
        meta: { mono: true },
        cell: ({ row }) => row.original.values[rangeKey],
      })),
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-4">
      <DateRangeToggle
        options={DATE_RANGE_KEYS.map((key) => ({ value: key, label: t(`ranges.${key}`) }))}
        aria-label={t("dateRangeAriaLabel")}
        value={dateRange}
        onValueChange={(value) => void handleRangeChange(value)}
        urlParam={null}
        loading={loading}
      />

      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}

      <Card className="p-4">
        <DataTable<KpiTableRow>
          columns={kpiColumns}
          data={kpiRows}
          getRowId={(row) => row.key}
          caption={t("kpiTableCaption")}
          captionVisuallyHidden
          status="ready"
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="text-sm font-medium text-foreground">{t("channelSplitHeading")}</h2>
          {overview.channelSplit.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noData")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {overview.channelSplit.map((row) => (
                <li key={row.channelKey} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{row.channelKey}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {row.conversationCount.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col gap-2 p-4">
          <h2 className="text-sm font-medium text-foreground">{t("topIntentsHeading")}</h2>
          {overview.topIntents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noData")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {overview.topIntents.map((row) => (
                <li key={row.intentKey} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{row.intentLabel}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {row.conversationCount.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
