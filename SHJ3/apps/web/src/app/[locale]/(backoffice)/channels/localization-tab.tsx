"use client";

/**
 * B10 tab 5 — Localization. Voice and enabled state are editable; direction is read-only
 * here (`platform.Locale`'s own concern, not a tenant-editable field — see
 * `update-locale.ts`'s doc comment), and `translatedPercent` is a computed persisted column,
 * shown but never writable.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { StatusCell, type StatusFamily } from "@/components/ui/status-cell";
import { DataTable } from "@/components/patterns/data-table/data-table";
import type { ColumnDef } from "@tanstack/react-table";
import type { LocaleRow } from "../../../../modules/channels/ports/locale-repository.js";
import type { ChannelsScreenActions } from "./channels-screen.js";

export interface LocalizationTabProps {
  readonly rows: readonly LocaleRow[];
  readonly coverage: Readonly<
    Record<string, { readonly translated: number; readonly total: number }>
  >;
  readonly actions: ChannelsScreenActions;
}

export function LocalizationTab({ rows, actions }: LocalizationTabProps): React.ReactElement {
  const t = useTranslations("channels.localization");
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [voiceDrafts, setVoiceDrafts] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.localeCode, r.voiceName ?? ""])),
  );

  async function handleSaveVoice(row: LocaleRow): Promise<void> {
    setError(null);
    const result = await actions.updateLocale({
      localeCode: row.localeCode,
      voiceName: voiceDrafts[row.localeCode]?.trim() || null,
      isEnabled: row.isEnabled,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.value.ok) {
      setError(t("fallbackLocaleRequiredError"));
      return;
    }
    router.refresh();
  }

  async function handleSetFallback(localeCode: string): Promise<void> {
    setError(null);
    const result = await actions.setFallbackLocale(localeCode);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  const family: StatusFamily = "info";

  const columns = React.useMemo<ColumnDef<LocaleRow, unknown>[]>(
    () => [
      {
        id: "englishName",
        accessorKey: "englishName",
        header: t("columnLocale"),
        meta: { identifying: true },
      },
      {
        id: "voiceName",
        header: t("columnVoice"),
        cell: ({ row }) => (
          <Input
            dir="ltr"
            value={voiceDrafts[row.original.localeCode] ?? ""}
            onChange={(event) =>
              setVoiceDrafts((prev) => ({ ...prev, [row.original.localeCode]: event.target.value }))
            }
            onBlur={() => void handleSaveVoice(row.original)}
          />
        ),
      },
      {
        id: "direction",
        accessorKey: "direction",
        header: t("columnDirection"),
        cell: ({ row }) => <StatusCell label={row.original.direction} family={family} rank={0} />,
      },
      {
        id: "translatedPercent",
        accessorKey: "translatedPercent",
        header: t("columnTranslated"),
        meta: { mono: true },
        cell: ({ row }) => `${String(row.original.translatedPercent)}%`,
      },
      {
        id: "isFallback",
        header: t("columnFallback"),
        cell: ({ row }) =>
          row.original.isFallback ? (
            <span aria-label={t("isFallback")}>✓</span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleSetFallback(row.original.localeCode)}
            >
              {t("setAsFallbackAction")}
            </Button>
          ),
      },
    ],
    [t, voiceDrafts],
  );

  return (
    <div className="flex flex-col gap-4">
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.localeCode}
        getRowLabel={(row) => row.englishName}
        caption={t("heading")}
        captionVisuallyHidden
      />
    </div>
  );
}
