"use client";

/** B1 tab 2 — Conversation explorer. Filter chips, table, transcript expand with a
 *  PII-redaction footer, and "Add to golden set" + "Export" actions.
 *
 * **Export is a bulk, filter-scoped action, not a per-row one** — `ExportConversations`
 * exports "every row the current filtered view shows" (its own doc comment), matching
 * `TranscriptExports.filterJson` storing the filter that was applied, not one
 * conversation id. The wireframe places an "Export" control inside each row's expanded
 * transcript as a static (non-interactive) mockup element; this implementation renders
 * the real, working version of that action once, scoped to the active filter, next to
 * the filter chips — the same control, made real rather than duplicated per row.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/patterns/data-table/data-table";
import { StatusCell, type StatusFamily } from "@/components/ui/status-cell";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CONVERSATION_OUTCOME_FILTERS,
  type ConversationListRow,
  type ConversationOutcomeFilter,
  type TranscriptTurnRow,
} from "../../../../modules/analytics/ports/conversation-explorer-repository.js";
import type { GoldenSetRow } from "../../../../modules/evaluation/ports/golden-set-repository.js";
import type { CommandCentreScreenActions } from "./command-centre-screen.js";

const OUTCOME_FAMILY: Readonly<Record<string, StatusFamily>> = {
  Active: "info",
  Resolved: "success",
  Escalated: "warning",
  Abandoned: "neutral",
};
const OUTCOME_RANK: Readonly<Record<string, number>> = {
  Escalated: 0,
  Active: 1,
  Resolved: 2,
  Abandoned: 3,
};

export interface ConversationExplorerTabProps {
  readonly initialConversations: readonly ConversationListRow[];
  readonly goldenSets: readonly GoldenSetRow[];
  readonly actions: CommandCentreScreenActions;
}

interface GoldenSetFormState {
  readonly goldenSetId: string;
  readonly mustRefuse: boolean;
  readonly expectedBehaviourOverride: string;
}

export function ConversationExplorerTab({
  initialConversations,
  goldenSets,
  actions,
}: ConversationExplorerTabProps): React.ReactElement {
  const t = useTranslations("commandCentre.explorer");

  const [filter, setFilter] = React.useState<ConversationOutcomeFilter>("All");
  const [conversations, setConversations] = React.useState(initialConversations);
  const [expandedIds, setExpandedIds] = React.useState<ReadonlySet<string>>(new Set());
  const [transcripts, setTranscripts] = React.useState<
    Record<string, readonly TranscriptTurnRow[]>
  >({});
  const [goldenSetForms, setGoldenSetForms] = React.useState<Record<string, GoldenSetFormState>>(
    {},
  );
  const [addedConversationIds, setAddedConversationIds] = React.useState<ReadonlySet<string>>(
    new Set(),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [exportNotice, setExportNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function handleFilterChange(next: ConversationOutcomeFilter): Promise<void> {
    setFilter(next);
    setError(null);
    const result = await actions.listConversations(next);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setConversations(result.value);
  }

  async function handleExpandedIdsChange(ids: ReadonlySet<string>): Promise<void> {
    setExpandedIds(ids);
    for (const id of ids) {
      if (transcripts[id]) continue;
      const result = await actions.getConversationTranscript(id);
      if (result.ok) {
        setTranscripts((prev) => ({ ...prev, [id]: result.value }));
      } else {
        setError(result.error);
      }
    }
  }

  function formFor(conversationId: string): GoldenSetFormState {
    return (
      goldenSetForms[conversationId] ?? {
        goldenSetId: goldenSets[0]?.id ?? "",
        mustRefuse: false,
        expectedBehaviourOverride: "",
      }
    );
  }

  function updateForm(conversationId: string, patch: Partial<GoldenSetFormState>): void {
    setGoldenSetForms((prev) => ({
      ...prev,
      [conversationId]: { ...formFor(conversationId), ...patch },
    }));
  }

  async function handleAddToGoldenSet(conversationId: string): Promise<void> {
    const form = formFor(conversationId);
    if (!form.goldenSetId) return;
    setBusy(true);
    setError(null);
    const result = await actions.addConversationToGoldenSet({
      conversationId,
      goldenSetId: form.goldenSetId,
      mustRefuse: form.mustRefuse,
      ...(form.expectedBehaviourOverride.trim()
        ? { expectedBehaviourOverride: form.expectedBehaviourOverride.trim() }
        : {}),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.value.ok) {
      setAddedConversationIds((prev) => new Set(prev).add(conversationId));
    } else if (result.value.error === "evaluation.case_already_added") {
      setAddedConversationIds((prev) => new Set(prev).add(conversationId));
    } else {
      setError(result.value.error);
    }
  }

  async function handleExport(): Promise<void> {
    setBusy(true);
    setError(null);
    setExportNotice(null);
    const result = await actions.exportConversations(filter, "Csv");
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setExportNotice(t("exportNotice", { count: result.value.exportedRowCount }));
  }

  const columns = React.useMemo<ColumnDef<ConversationListRow, unknown>[]>(
    () => [
      {
        id: "displayUserMasked",
        accessorKey: "displayUserMasked",
        header: t("columnUser"),
        meta: { identifying: true },
        cell: ({ row }) => row.original.displayUserMasked ?? t("unknownCitizen"),
      },
      { id: "channelKey", accessorKey: "channelKey", header: t("columnChannel") },
      { id: "intentLabel", accessorKey: "intentLabel", header: t("columnIntent") },
      {
        id: "outcome",
        accessorKey: "outcome",
        header: t("columnOutcome"),
        cell: ({ row }) => (
          <StatusCell
            family={OUTCOME_FAMILY[row.original.outcome] ?? "neutral"}
            label={t(`outcomes.${row.original.outcome}` as "outcomes.Active")}
            rank={OUTCOME_RANK[row.original.outcome] ?? 99}
          />
        ),
      },
      {
        id: "rating",
        accessorKey: "rating",
        header: t("columnRating"),
        cell: ({ row }) =>
          row.original.rating === "Up" ? "👍" : row.original.rating === "Down" ? "👎" : "—",
      },
      {
        id: "lastTurnAt",
        accessorKey: "lastTurnAt",
        header: t("columnWhen"),
        cell: ({ row }) =>
          new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(
            row.original.lastTurnAt,
          ),
      },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {CONVERSATION_OUTCOME_FILTERS.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={filter === option ? "primary" : "outline"}
              onClick={() => void handleFilterChange(option)}
            >
              {t(`filters.${option}`)}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleExport()}
          disabled={busy}
        >
          {t("exportAction")}
        </Button>
      </div>

      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
      {exportNotice ? <InlineAlert variant="success">{exportNotice}</InlineAlert> : null}

      <DataTable<ConversationListRow>
        columns={columns}
        data={conversations}
        getRowId={(row) => row.id}
        caption={t("tableCaption")}
        status={conversations.length === 0 ? "empty" : "ready"}
        emptyContent={<EmptyState headline={t("emptyHeadline")} cause={t("emptyCause")} />}
        expandable
        expandedIds={expandedIds}
        onExpandedIdsChange={(ids) => void handleExpandedIdsChange(ids)}
        renderExpandedRow={(row) => {
          const transcript = transcripts[row.id];
          const alreadyAdded = addedConversationIds.has(row.id);
          const form = formFor(row.id);
          return (
            <div className="flex flex-col gap-3 p-4">
              {!transcript ? (
                <p className="text-sm text-muted-foreground">{t("loadingTranscript")}</p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {transcript.map((turn) => (
                    <li key={turn.id} className="text-sm">
                      <span className="font-medium text-foreground">
                        {t(`roles.${turn.role}` as "roles.Citizen")}:{" "}
                      </span>
                      <span className="text-muted-foreground">{turn.contentMasked}</span>
                    </li>
                  ))}
                </ol>
              )}
              <p className="text-xs text-muted-foreground">
                {t("footer", {
                  outcome: t(`outcomes.${row.outcome}` as "outcomes.Active"),
                  rating: row.rating === "Up" ? "👍" : row.rating === "Down" ? "👎" : "—",
                })}
              </p>
              <p className="text-xs text-muted-foreground">{t("redactionNotice")}</p>

              <div className="flex flex-col gap-2 border-t border-border pt-3">
                {alreadyAdded ? (
                  <p className="text-sm text-muted-foreground">{t("alreadyAddedNotice")}</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="h-9 rounded-md border border-border-strong bg-input px-2 text-sm text-foreground"
                        value={form.goldenSetId}
                        onChange={(event) =>
                          updateForm(row.id, { goldenSetId: event.target.value })
                        }
                        aria-label={t("goldenSetFieldLabel")}
                      >
                        {goldenSets.map((set) => (
                          <option key={set.id} value={set.id}>
                            {set.name}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-2 text-sm text-foreground">
                        <Checkbox
                          checked={form.mustRefuse}
                          onCheckedChange={(checked) =>
                            updateForm(row.id, { mustRefuse: checked === true })
                          }
                        />
                        {t("mustRefuseLabel")}
                      </label>
                    </div>
                    <Textarea
                      placeholder={t("expectedBehaviourPlaceholder")}
                      value={form.expectedBehaviourOverride}
                      onChange={(event) =>
                        updateForm(row.id, { expectedBehaviourOverride: event.target.value })
                      }
                    />
                    <div>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy || !form.goldenSetId}
                        onClick={() => void handleAddToGoldenSet(row.id)}
                      >
                        {t("addToGoldenSetAction")}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        }}
      />
    </div>
  );
}
