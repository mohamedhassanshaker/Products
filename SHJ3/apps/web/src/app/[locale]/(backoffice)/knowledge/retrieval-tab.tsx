"use client";

/**
 * B6 tab 3 — retrieval configuration, the playground, and the re-index job history
 * (FR-KNOW-11..16). The graph/vector weight slider is one degree of freedom
 * (`domain/retrieval-config.ts`'s `weightsSumToOne`): moving it recomputes the other side
 * client-side before the form can even be submitted, matching FR-KNOW-12's "live numeric
 * label" requirement.
 */

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Slider } from "@/components/ui/slider";
import { StatusCell, type StatusFamily } from "@/components/ui/status-cell";
import { Switch } from "@/components/ui/switch";
import { DataTable } from "@/components/patterns/data-table/data-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/patterns/dialog";
import type { ReindexJobState } from "../../../../modules/knowledge/domain/knowledge-catalog.js";
import type { RetrievalQueryResult } from "../../../../modules/knowledge/ports/knowledge-ai-client.js";
import type { ReindexJobRow } from "../../../../modules/knowledge/ports/reindex-job-repository.js";
import type { RetrievalConfigRow } from "../../../../modules/knowledge/ports/retrieval-config-repository.js";
import type { KnowledgeScreenActions } from "./knowledge-screen.js";

export interface RetrievalTabProps {
  readonly config: RetrievalConfigRow;
  readonly reindexJobs: readonly ReindexJobRow[];
  readonly actions: KnowledgeScreenActions;
}

type RetrievalPresetKey = "fast" | "balanced" | "thorough";

interface RetrievalPresetValues {
  readonly chunkSizeTokens: number;
  readonly chunkOverlapTokens: number;
  readonly topK: number;
  readonly rerankCandidateCount: number;
  readonly graphWeightPercent: number;
}

/**
 * review-comments-3: "not user friendly" — a raw chunk-size/overlap/top-K/rerank-count/
 * graph-weight form asks a non-technical admin to reason about numbers with no felt
 * consequence. `balanced` is `RETRIEVAL_CONFIG_DEFAULTS` verbatim (`domain/retrieval-
 * config.ts`) — picking it must never silently change behavior for a tenant already running
 * on the shipped defaults. `fast`/`thorough` scale the same five knobs symmetrically around
 * it (smaller/larger chunks, fewer/more candidates, less/more graph weight) — a real,
 * reviewable judgment call, not a derived formula, so a product owner can tune these three
 * rows directly.
 */
const RETRIEVAL_PRESETS: Readonly<Record<RetrievalPresetKey, RetrievalPresetValues>> = {
  fast: {
    chunkSizeTokens: 256,
    chunkOverlapTokens: 32,
    topK: 5,
    rerankCandidateCount: 15,
    graphWeightPercent: 40,
  },
  balanced: {
    chunkSizeTokens: 512,
    chunkOverlapTokens: 64,
    topK: 8,
    rerankCandidateCount: 40,
    graphWeightPercent: 60,
  },
  thorough: {
    chunkSizeTokens: 1024,
    chunkOverlapTokens: 128,
    topK: 15,
    rerankCandidateCount: 60,
    graphWeightPercent: 70,
  },
};

/** The preset (if any) whose values exactly match the current form — used both to mark a preset button "active" on load and to detect a hand-edit that should fall back to "Custom". */
function matchingPreset(form: {
  readonly chunkSizeTokens: number;
  readonly chunkOverlapTokens: number;
  readonly topK: number;
  readonly rerankCandidateCount: number;
  readonly graphWeightPercent: number;
}): RetrievalPresetKey | "custom" {
  const match = (Object.keys(RETRIEVAL_PRESETS) as RetrievalPresetKey[]).find((key) => {
    const preset = RETRIEVAL_PRESETS[key];
    return (
      preset.chunkSizeTokens === form.chunkSizeTokens &&
      preset.chunkOverlapTokens === form.chunkOverlapTokens &&
      preset.topK === form.topK &&
      preset.rerankCandidateCount === form.rerankCandidateCount &&
      preset.graphWeightPercent === form.graphWeightPercent
    );
  });
  return match ?? "custom";
}

const JOB_STATE_FAMILY: Readonly<Record<ReindexJobState, StatusFamily>> = {
  Queued: "neutral",
  Running: "info",
  Completed: "success",
  Failed: "destructive",
};

/** Sort rank for the job-state column (design-system.md §5.4 #39 — never alphabetical). */
const JOB_STATE_RANK: Readonly<Record<ReindexJobState, number>> = {
  Failed: 0,
  Running: 1,
  Queued: 2,
  Completed: 3,
};

export function RetrievalTab({
  config,
  reindexJobs,
  actions,
}: RetrievalTabProps): React.ReactElement {
  const t = useTranslations("knowledge.retrieval");
  const locale = useLocale();
  const router = useRouter();

  const [form, setForm] = React.useState(config);
  const [graphWeightPercent, setGraphWeightPercent] = React.useState(
    Math.round(config.graphWeight * 100),
  );
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [pendingSave, setPendingSave] = React.useState(false);
  const [confirmModelChange, setConfirmModelChange] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const [query, setQuery] = React.useState("");
  const [playgroundPending, setPlaygroundPending] = React.useState(false);
  const [playgroundResult, setPlaygroundResult] = React.useState<RetrievalQueryResult | null>(null);

  const [reindexPending, setReindexPending] = React.useState(false);

  const dateFormatter = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  const modelChanged =
    form.embeddingModel !== config.embeddingModel ||
    form.embeddingDimension !== config.embeddingDimension;

  const activePreset = React.useMemo(
    () =>
      matchingPreset({
        chunkSizeTokens: form.chunkSizeTokens,
        chunkOverlapTokens: form.chunkOverlapTokens,
        topK: form.topK,
        rerankCandidateCount: form.rerankCandidateCount,
        graphWeightPercent,
      }),
    [form.chunkSizeTokens, form.chunkOverlapTokens, form.topK, form.rerankCandidateCount, graphWeightPercent],
  );

  function applyPreset(key: RetrievalPresetKey): void {
    const preset = RETRIEVAL_PRESETS[key];
    setForm((f) => ({
      ...f,
      chunkSizeTokens: preset.chunkSizeTokens,
      chunkOverlapTokens: preset.chunkOverlapTokens,
      topK: preset.topK,
      rerankCandidateCount: preset.rerankCandidateCount,
    }));
    setGraphWeightPercent(preset.graphWeightPercent);
  }

  async function doSave(): Promise<void> {
    setPendingSave(true);
    const result = await actions.updateRetrievalConfig({
      chunkSizeTokens: form.chunkSizeTokens,
      chunkOverlapTokens: form.chunkOverlapTokens,
      embeddingModel: form.embeddingModel,
      embeddingDimension: form.embeddingDimension,
      graphWeight: graphWeightPercent / 100,
      vectorWeight: 1 - graphWeightPercent / 100,
      topK: form.topK,
      rerankerEnabled: form.rerankerEnabled,
      rerankerModel: form.rerankerModel,
      rerankCandidateCount: form.rerankCandidateCount,
      minGroundingConfidence: form.minGroundingConfidence,
      defaultConflictPolicy: form.defaultConflictPolicy,
      maxGraphHops: form.maxGraphHops,
    });
    setPendingSave(false);
    setConfirmModelChange(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.value.update.ok) {
      setError(t(`saveError.${result.value.update.reason}`));
      return;
    }
    setError(null);
    setNotice(result.value.reindexJobs ? t("modelChangeQueuedNotice") : t("savedNotice"));
    router.refresh();
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (modelChanged) {
      setConfirmModelChange(true);
      return;
    }
    void doSave();
  }

  async function handleRunPlayground(): Promise<void> {
    setPlaygroundPending(true);
    const result = await actions.runRetrievalPlayground({ query, knowledgeCollectionIds: null });
    setPlaygroundPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setPlaygroundResult(result.value.result);
  }

  async function handleReindexAll(): Promise<void> {
    setReindexPending(true);
    const result = await actions.triggerReindexAll();
    setReindexPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.value.ok) {
      setError(t(`reindexError.${result.value.reason}`));
      return;
    }
    router.refresh();
  }

  const jobColumns = React.useMemo<ColumnDef<ReindexJobRow, unknown>[]>(
    () => [
      {
        id: "scope",
        accessorKey: "scope",
        header: t("columnScope"),
        cell: ({ row }) => t(`jobScope.${row.original.scope}`),
      },
      {
        id: "reason",
        accessorKey: "reason",
        header: t("columnReason"),
        cell: ({ row }) => t(`jobReason.${row.original.reason}`),
      },
      {
        id: "state",
        accessorKey: "state",
        header: t("columnState"),
        cell: ({ row }) => (
          <StatusCell
            label={t(`jobState.${row.original.state}`)}
            family={JOB_STATE_FAMILY[row.original.state]}
            rank={JOB_STATE_RANK[row.original.state]}
          />
        ),
      },
      {
        id: "progress",
        accessorKey: "progressPercent",
        header: t("columnProgress"),
        cell: ({ row }) => `${row.original.progressPercent}%`,
      },
      {
        id: "createdAt",
        accessorKey: "createdAt",
        header: t("columnCreatedAt"),
        cell: ({ row }) => dateFormatter.format(row.original.createdAt),
      },
    ],
    [t, dateFormatter],
  );

  return (
    <div className="flex flex-col gap-8">
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
      {notice ? <InlineAlert variant="success">{notice}</InlineAlert> : null}

      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <h2 className="text-sm font-medium text-foreground">{t("configHeading")}</h2>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {(["fast", "balanced", "thorough"] as const).map((key) => (
              <Button
                key={key}
                type="button"
                variant={activePreset === key ? "primary" : "outline"}
                size="sm"
                aria-pressed={activePreset === key}
                onClick={() => applyPreset(key)}
              >
                {t(`preset.${key}.label`)}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {activePreset === "custom"
              ? t("presetActiveCustom")
              : t(`preset.${activePreset}.description`)}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t("fieldEmbeddingModel")} help={t("fieldEmbeddingModelHelp")}>
            {(field) => (
              <Input
                {...field}
                dir="ltr"
                value={form.embeddingModel}
                onChange={(event) => setForm({ ...form, embeddingModel: event.target.value })}
              />
            )}
          </FormField>
          <FormField label={t("fieldEmbeddingDimension")}>
            {(field) => (
              <Input
                {...field}
                type="number"
                variant="mono"
                value={form.embeddingDimension}
                onChange={(event) =>
                  setForm({ ...form, embeddingDimension: Number(event.target.value) })
                }
              />
            )}
          </FormField>
        </div>

        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
            className="self-start"
          >
            <Icon icon={advancedOpen ? ChevronUp : ChevronDown} size={14} />
            {t("advancedToggleLabel")}
          </Button>
          {advancedOpen ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label={t("fieldChunkSize")}>
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    variant="mono"
                    value={form.chunkSizeTokens}
                    onChange={(event) =>
                      setForm({ ...form, chunkSizeTokens: Number(event.target.value) })
                    }
                  />
                )}
              </FormField>
              <FormField label={t("fieldChunkOverlap")}>
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    variant="mono"
                    value={form.chunkOverlapTokens}
                    onChange={(event) =>
                      setForm({ ...form, chunkOverlapTokens: Number(event.target.value) })
                    }
                  />
                )}
              </FormField>
              <FormField label={t("fieldTopK")}>
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    variant="mono"
                    value={form.topK}
                    onChange={(event) => setForm({ ...form, topK: Number(event.target.value) })}
                  />
                )}
              </FormField>
              <FormField label={t("fieldRerankCandidateCount")}>
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    variant="mono"
                    value={form.rerankCandidateCount}
                    onChange={(event) =>
                      setForm({ ...form, rerankCandidateCount: Number(event.target.value) })
                    }
                  />
                )}
              </FormField>
            </div>
          ) : null}
        </div>

        <FormField
          label={t("fieldWeighting", {
            graph: graphWeightPercent,
            vector: 100 - graphWeightPercent,
          })}
        >
          {() => (
            <Slider
              variant="single"
              aria-label={t("fieldWeighting", {
                graph: graphWeightPercent,
                vector: 100 - graphWeightPercent,
              })}
              min={0}
              max={100}
              step={5}
              value={graphWeightPercent}
              onValueChange={setGraphWeightPercent}
              locale={locale}
              formatValue={(value) => `${value}% / ${100 - value}%`}
            />
          )}
        </FormField>

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-foreground">{t("fieldRerankerEnabled")}</span>
          <Switch
            checked={form.rerankerEnabled}
            onCheckedChange={(checked) => setForm({ ...form, rerankerEnabled: checked })}
          />
        </div>

        <div>
          <Button type="submit" loading={pendingSave}>
            {t("saveAction")}
          </Button>
        </div>
      </form>

      {confirmModelChange ? (
        <Dialog open onOpenChange={(open) => !open && setConfirmModelChange(false)}>
          <DialogContent size="sm" closeLabel={t("closeLabel")}>
            <DialogHeader>
              <DialogTitle>{t("modelChangeConfirmTitle")}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-foreground">{t("modelChangeConfirmBody")}</p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmModelChange(false)}
                disabled={pendingSave}
              >
                {t("cancel")}
              </Button>
              <Button type="button" loading={pendingSave} onClick={() => void doSave()}>
                {t("modelChangeConfirmAction")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-foreground">{t("playgroundHeading")}</h2>
        <FormField label={t("fieldQuery")}>
          {(field) => (
            <Input {...field} value={query} onChange={(event) => setQuery(event.target.value)} />
          )}
        </FormField>
        <div>
          <Button
            type="button"
            loading={playgroundPending}
            onClick={() => void handleRunPlayground()}
            disabled={!query.trim()}
          >
            {t("runAction")}
          </Button>
        </div>

        {playgroundResult ? (
          <div className="flex flex-col gap-3 rounded-md border border-border p-4">
            {playgroundResult.degraded ? (
              <InlineAlert variant="warning">
                {t("degradedNotice", { reasons: playgroundResult.degradationReasons.join(", ") })}
              </InlineAlert>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {t("groundingConfidenceLabel", {
                value: Math.round(playgroundResult.groundingConfidence * 100),
              })}
            </p>
            <ul className="flex flex-col gap-2">
              {playgroundResult.results.map((result) => (
                <li key={result.chunkId} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {result.knowledgeSourceName}
                    </span>
                    <span className="font-mono text-2xs text-muted-foreground">
                      {t("scoreLabel", { value: result.score.toFixed(2) })}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{result.text}</p>
                </li>
              ))}
            </ul>
            {playgroundResult.matchedSubgraph.renderedPath ? (
              <p className="font-mono text-xs text-foreground">
                {playgroundResult.matchedSubgraph.renderedPath}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium text-foreground">{t("jobsHeading")}</h2>
          <Button
            type="button"
            variant="outline"
            loading={reindexPending}
            onClick={() => void handleReindexAll()}
          >
            {t("reindexAllAction")}
          </Button>
        </div>
        <DataTable
          columns={jobColumns}
          data={reindexJobs}
          getRowId={(row) => row.id}
          caption={t("jobsHeading")}
          captionVisuallyHidden
        />
      </div>
    </div>
  );
}
