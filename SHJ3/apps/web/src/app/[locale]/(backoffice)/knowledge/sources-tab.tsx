"use client";

/**
 * B6 tab 1 — Knowledge sources (FR-KNOW-01..05). `Document` is the one source type this
 * wave wires end to end (real chunking, real re-crawl, real removal cascade); the other
 * four (`UrlCrawler`, `Database`, `SharePoint`, `ApiFeed`) are real, persisted, schedulable
 * rows with no fetch mechanics behind them yet — said out loud in the UI (`fetchNotWiredNote`
 * on non-Document rows) rather than left to look silently broken at 0%.
 */

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { ProgressBar } from "@/components/ui/progress-bar";
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
import {
  SOURCE_SCHEDULES,
  SOURCE_TYPES,
  type SourceSchedule,
  type SourceStatus,
  type SourceType,
} from "../../../../modules/knowledge/domain/knowledge-catalog.js";
import type { KnowledgeSourceRow } from "../../../../modules/knowledge/ports/knowledge-source-repository.js";
import type { KnowledgeScreenActions } from "./knowledge-screen.js";

export interface SourcesTabProps {
  readonly rows: readonly KnowledgeSourceRow[];
  readonly actions: KnowledgeScreenActions;
}

const STATUS_FAMILY: Readonly<Record<SourceStatus, StatusFamily>> = {
  Idle: "neutral",
  Crawling: "info",
  Indexing: "info",
  Failed: "destructive",
};

/** Sort rank for the status column (design-system.md §5.4 #39 — never alphabetical): Failed surfaces first, then the active states, then the quiet Idle state. */
const STATUS_RANK: Readonly<Record<SourceStatus, number>> = {
  Failed: 0,
  Crawling: 1,
  Indexing: 2,
  Idle: 3,
};

type DialogState =
  | { readonly kind: "none" }
  | { readonly kind: "create" }
  | { readonly kind: "remove"; readonly row: KnowledgeSourceRow };

function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function SourcesTab({ rows, actions }: SourcesTabProps): React.ReactElement {
  const t = useTranslations("knowledge.sources");
  const locale = useLocale();
  const router = useRouter();
  const [dialog, setDialog] = React.useState<DialogState>({ kind: "none" });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const dateFormatter = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  const statusLabel = React.useCallback(
    (status: SourceStatus): string => t(`status.${status}`),
    [t],
  );
  const sourceTypeLabel = React.useCallback(
    (type: SourceType): string => t(`sourceType.${type}`),
    [t],
  );
  const scheduleLabel = React.useCallback(
    (schedule: SourceSchedule): string => t(`schedule.${schedule}`),
    [t],
  );

  function onMutationSucceeded(): void {
    setDialog({ kind: "none" });
    setError(null);
    router.refresh();
  }

  async function handleRecrawl(row: KnowledgeSourceRow): Promise<void> {
    setPending(true);
    const result = await actions.recrawlSource(row.id);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.value.ok) {
      setError(t(`recrawlError.${result.value.reason}`));
      return;
    }
    onMutationSucceeded();
  }

  async function handleRemove(row: KnowledgeSourceRow): Promise<void> {
    setPending(true);
    const result = await actions.removeSource(row.id);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onMutationSucceeded();
  }

  const columns = React.useMemo<ColumnDef<KnowledgeSourceRow, unknown>[]>(
    () => [
      { id: "name", accessorKey: "name", header: t("columnName"), meta: { identifying: true } },
      {
        id: "sourceType",
        accessorKey: "sourceType",
        header: t("columnType"),
        cell: ({ row }) => sourceTypeLabel(row.original.sourceType),
      },
      {
        id: "schedule",
        accessorKey: "schedule",
        header: t("columnSchedule"),
        cell: ({ row }) => scheduleLabel(row.original.schedule),
      },
      {
        id: "indexedPercent",
        accessorKey: "indexedPercent",
        header: t("columnIndexed"),
        cell: ({ row }) => (
          <ProgressBar value={row.original.indexedPercent} locale={locale} className="w-32" />
        ),
      },
      {
        id: "lastCrawledAt",
        accessorKey: "lastCrawledAt",
        header: t("columnLastCrawled"),
        cell: ({ row }) =>
          row.original.lastCrawledAt
            ? dateFormatter.format(row.original.lastCrawledAt)
            : t("never"),
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
      },
    ],
    [t, dateFormatter, locale, sourceTypeLabel, scheduleLabel, statusLabel],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">{t("heading")}</h2>
        <Button type="button" size="sm" onClick={() => setDialog({ kind: "create" })}>
          {t("createAction")}
        </Button>
      </div>

      <InlineAlert variant="info">{t("fetchNotWiredNote")}</InlineAlert>

      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.name}
        caption={t("heading")}
        captionVisuallyHidden
        renderRowActions={(row) => (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => void handleRecrawl(row)}
            >
              {t("recrawlAction")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDialog({ kind: "remove", row })}
            >
              {t("removeAction")}
            </Button>
          </div>
        )}
      />

      {dialog.kind === "create" ? (
        <AddSourceDialog
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          pending={pending}
          onSubmit={async (input) => {
            setPending(true);
            const result = await actions.addSource(input);
            setPending(false);
            if (result.ok) onMutationSucceeded();
            else setError(result.error);
          }}
        />
      ) : null}

      {dialog.kind === "remove" ? (
        <DestructiveConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          title={t("removeConfirmTitle")}
          objectName={dialog.row.name}
          descriptionTemplate={(name) => t("removeConfirmDescription", { name })}
          actionLabel={t("removeConfirmAction")}
          cancelLabel={t("cancel")}
          confirming={pending}
          onConfirm={() => void handleRemove(dialog.row)}
        />
      ) : null}
    </div>
  );
}

interface AddSourceDialogProps {
  readonly onOpenChange: (open: boolean) => void;
  readonly pending: boolean;
  readonly onSubmit: (input: {
    readonly name: string;
    readonly sourceType: SourceType;
    readonly location: string;
    readonly schedule: SourceSchedule;
    readonly credentialSecretRef: string | null;
    readonly documentText: string | null;
    readonly localeCode: string;
  }) => Promise<void>;
}

function AddSourceDialog({ onOpenChange, pending, onSubmit }: AddSourceDialogProps) {
  const t = useTranslations("knowledge.sources");
  const [name, setName] = React.useState("");
  const [sourceType, setSourceType] = React.useState<SourceType>("Document");
  const [location, setLocation] = React.useState("");
  const [schedule, setSchedule] = React.useState<SourceSchedule>("Manual");
  const [credentialSecretRef, setCredentialSecretRef] = React.useState("");
  const [documentText, setDocumentText] = React.useState("");

  const isDocument = sourceType === "Document";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="lg" closeLabel={t("closeLabel")}>
        <DialogHeader>
          <DialogTitle>{t("createDialogTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit({
              name,
              sourceType,
              location: isDocument ? t("pastedTextLocation") : location,
              schedule,
              credentialSecretRef: trimmedOrNull(credentialSecretRef),
              documentText: isDocument ? documentText : null,
              localeCode: "en",
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
          <FormField label={t("fieldSourceType")}>
            {(field) => (
              <Select
                value={sourceType}
                onValueChange={(value) => setSourceType(value as SourceType)}
              >
                <SelectTrigger {...field}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_TYPES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`sourceType.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          {!isDocument ? (
            <FormField label={t("fieldLocation")} help={t("fieldLocationHelp")}>
              {(field) => (
                <Input
                  {...field}
                  dir="ltr"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  required
                />
              )}
            </FormField>
          ) : null}
          <FormField label={t("fieldSchedule")}>
            {(field) => (
              <Select
                value={schedule}
                onValueChange={(value) => setSchedule(value as SourceSchedule)}
              >
                <SelectTrigger {...field}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_SCHEDULES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`schedule.${option}`)}
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
          {isDocument ? (
            <FormField label={t("fieldDocumentText")} help={t("fieldDocumentTextHelp")}>
              {(field) => (
                <Textarea
                  {...field}
                  value={documentText}
                  onChange={(event) => setDocumentText(event.target.value)}
                  required
                  rows={8}
                />
              )}
            </FormField>
          ) : (
            <InlineAlert variant="info">{t("nonDocumentCreateNote")}</InlineAlert>
          )}

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
              {t("createDialogSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
