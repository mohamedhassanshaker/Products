"use client";

/**
 * B6 tab 2 — entity graph explorer (FR-KNOW-06..08/10) plus the duplicate-detection queue
 * (FR-KNOW-09) and the G11/G12 graph-health banner, together per the wireframe's own tab 2
 * layout.
 *
 * Renders via `GraphCanvasListView` (`components/patterns/graph-canvas`) rather than the
 * SVG `GraphCanvas` — that component "consumes a layout, it does not compute one" (its own
 * doc comment), and no layout service exists; the locked AI contract's `graph/browse`
 * response carries no `x`/`y` either. The list view needs no coordinates to be useful, and
 * matches this wave's own instruction not to over-invest in graph visualisation for a
 * backoffice tool.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { SearchField } from "@/components/ui/search-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusCell } from "@/components/ui/status-cell";
import { DataTable } from "@/components/patterns/data-table/data-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/patterns/dialog";
import {
  GRAPH_ENTITY_TYPE_META,
  GraphCanvasListView,
  GraphCanvasMergeDialog,
  type GraphEdge as CanvasEdge,
  type GraphEntityType,
  type GraphNode as CanvasNode,
} from "@/components/patterns/graph-canvas";
import {
  GRAPH_LABELS,
  type GraphLabel,
} from "../../../../modules/knowledge/domain/knowledge-catalog.js";
import type { GraphDuplicateCandidateRow } from "../../../../modules/knowledge/ports/graph-repository.js";
import type { GraphInvariantsResult } from "../../../../modules/knowledge/ports/knowledge-ai-client.js";
import type { KnowledgeScreenActions } from "./knowledge-screen.js";

export interface GraphTabProps {
  readonly duplicateCandidates: readonly GraphDuplicateCandidateRow[];
  readonly graphHealth: GraphInvariantsResult;
  readonly actions: KnowledgeScreenActions;
}

function toCanvasType(label: string): GraphEntityType {
  const lower = label.toLowerCase();
  return (lower in GRAPH_ENTITY_TYPE_META ? lower : "service") as GraphEntityType;
}

export function GraphTab({
  duplicateCandidates,
  graphHealth,
  actions,
}: GraphTabProps): React.ReactElement {
  const t = useTranslations("knowledge.graph");
  const [nodes, setNodes] = React.useState<readonly CanvasNode[]>([]);
  const [edges, setEdges] = React.useState<readonly CanvasEdge[]>([]);
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [addNodeOpen, setAddNodeOpen] = React.useState(false);
  const [detectLabel, setDetectLabel] = React.useState<GraphLabel>("Provider");
  const [candidates, setCandidates] = React.useState(duplicateCandidates);
  const [mergeTarget, setMergeTarget] = React.useState<GraphDuplicateCandidateRow | null>(null);

  const load = React.useCallback(
    async (rootKey: string | null) => {
      setLoading(true);
      const result = await actions.browseGraph({ rootKey, depth: 1, types: null, limit: 100 });
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNodes(
        result.value.nodes.map((node) => ({
          id: node.key,
          type: toCanvasType(node.label),
          label: node.name,
          x: 0,
          y: 0,
        })),
      );
      setEdges(
        result.value.edges.map((edge) => ({
          id: `${edge.from}::${edge.type}::${edge.to}`,
          sourceId: edge.from,
          targetId: edge.to,
          relationshipLabel: edge.type,
        })),
      );
    },
    [actions],
  );

  React.useEffect(() => {
    void load(null);
    // Runs once on mount — `load` closes over a fresh `actions` prop that is stable across
    // renders in this app's composition, and re-fetching on every render would defeat the
    // point of the client-side filter below. No `react-hooks/exhaustive-deps` rule is
    // configured in this repo's eslint config, so no suppression comment is needed here.
  }, []);

  const visibleNodes = React.useMemo(() => {
    if (!query.trim()) return nodes;
    const needle = query.trim().toLowerCase();
    return nodes.filter((node) => node.label.toLowerCase().includes(needle));
  }, [nodes, query]);

  const entityTypeLabels = React.useMemo<Readonly<Record<string, string>>>(
    () => ({
      service: t("entityType.Service"),
      provider: t("entityType.Provider"),
      fee: t("entityType.Fee"),
      document: t("entityType.Document"),
      channel: t("entityType.Channel"),
    }),
    [t],
  );

  async function handleDetectDuplicates(): Promise<void> {
    setLoading(true);
    const result = await actions.detectDuplicates(detectLabel);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCandidates(result.value.candidates);
  }

  async function handleMergeConfirmed(candidate: GraphDuplicateCandidateRow): Promise<void> {
    setMergeTarget(null);
    const result = await actions.mergeDuplicate(candidate.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.value.ok) {
      setError(t(`duplicateActionError.${result.value.reason}`));
      return;
    }
    setCandidates((current) => current.filter((row) => row.id !== candidate.id));
  }

  async function handleIgnore(candidate: GraphDuplicateCandidateRow): Promise<void> {
    const result = await actions.ignoreDuplicate(candidate.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.value.ok) {
      setError(t(`duplicateActionError.${result.value.reason}`));
      return;
    }
    setCandidates((current) => current.filter((row) => row.id !== candidate.id));
  }

  const healthy =
    graphHealth.labelledButWrongProp === 0 &&
    graphHealth.propButNoLabel === 0 &&
    graphHealth.crossTenantEdges === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <StatusCell
          label={healthy ? t("healthOk") : t("healthAlert")}
          family={healthy ? "success" : "destructive"}
          rank={0}
        />
        {!healthy ? (
          <span className="text-sm text-muted-foreground">
            {t("healthDetail", {
              a: graphHealth.labelledButWrongProp,
              b: graphHealth.propButNoLabel,
              c: graphHealth.crossTenantEdges,
            })}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium text-foreground">{t("explorerHeading")}</h2>
          <Button type="button" size="sm" onClick={() => setAddNodeOpen(true)}>
            {t("addNodeAction")}
          </Button>
        </div>

        {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}

        <SearchField
          aria-label={t("searchLabel")}
          value={query}
          onValueChange={setQuery}
          placeholder={t("searchPlaceholder")}
        />

        <GraphCanvasListView
          nodes={visibleNodes}
          edges={edges}
          entityTypeLabels={entityTypeLabels}
          onSelectNode={(nodeId) => void load(nodeId)}
          captionText={t("explorerHeading")}
          entityColumnLabel={t("columnEntity")}
          typeColumnLabel={t("columnType")}
          relationshipsColumnLabel={t("columnRelationships")}
          emptyContent={
            nodes.length === 0 ? (
              <EmptyState headline={t("noEntitiesHeadline")} cause={t("noEntitiesCause")} />
            ) : (
              <EmptyState
                variant="no-results"
                headline={t("noEntitiesMatchHeadline")}
                cause={t("noEntitiesMatchCause")}
              />
            )
          }
        />
        {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium text-foreground">{t("duplicatesHeading")}</h2>
          <div className="flex items-center gap-2">
            <Select
              value={detectLabel}
              onValueChange={(value) => setDetectLabel(value as GraphLabel)}
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRAPH_LABELS.map((label) => (
                  <SelectItem key={label} value={label}>
                    {t(`entityType.${label}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handleDetectDuplicates()}
            >
              {t("detectAction")}
            </Button>
          </div>
        </div>

        <DataTable
          columns={[
            {
              id: "left",
              accessorFn: (row: GraphDuplicateCandidateRow) => row.leftName,
              header: t("columnLeft"),
            },
            {
              id: "right",
              accessorFn: (row: GraphDuplicateCandidateRow) => row.rightName,
              header: t("columnRight"),
            },
            {
              id: "similarity",
              accessorFn: (row: GraphDuplicateCandidateRow) => row.similarity,
              header: t("columnSimilarity"),
              cell: ({ row }) => `${Math.round(row.original.similarity * 100)}%`,
              meta: { mono: true },
            },
          ]}
          data={candidates}
          getRowId={(row) => row.id}
          getRowLabel={(row) => `${row.leftName} / ${row.rightName}`}
          caption={t("duplicatesHeading")}
          captionVisuallyHidden
          status={candidates.length === 0 ? "empty" : "ready"}
          emptyContent={<EmptyState headline={t("noDuplicates")} cause={t("noDuplicatesCause")} />}
          renderRowActions={(row) => (
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setMergeTarget(row)}>
                {t("mergeAction")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleIgnore(row)}
              >
                {t("ignoreAction")}
              </Button>
            </div>
          )}
        />
      </div>

      {mergeTarget ? (
        <GraphCanvasMergeDialog
          open
          primaryLabel={mergeTarget.leftName}
          duplicateLabel={mergeTarget.rightName}
          dialogTitle={t("mergeDialogTitle")}
          describeMerge={(duplicateLabel, primaryLabel) =>
            t("mergeDialogDescription", { duplicateLabel, primaryLabel })
          }
          confirmLabel={t("mergeConfirmAction")}
          cancelLabel={t("cancel")}
          onConfirm={() => void handleMergeConfirmed(mergeTarget)}
          onCancel={() => setMergeTarget(null)}
        />
      ) : null}

      {addNodeOpen ? (
        <AddNodeDialog
          onOpenChange={setAddNodeOpen}
          onSubmit={async (input) => {
            const result = await actions.addGraphNode(input);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            if (!result.value.ok) {
              setError(t(`addNodeError.${result.value.reason}`));
              return;
            }
            setAddNodeOpen(false);
            await load(null);
          }}
        />
      ) : null}
    </div>
  );
}

interface AddNodeDialogProps {
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (input: {
    readonly label: GraphLabel;
    readonly canonicalKey: string;
    readonly canonicalName: string;
    readonly parent: { readonly label: GraphLabel; readonly canonicalKey: string } | null;
    readonly relationshipType: null;
  }) => Promise<void>;
}

/** A parent is optional and, when given, is identified by its exact canonical key + label — this wave's UI asks for both directly rather than building a full entity picker, matching the brief's "even a simple ... rendering is fine" stance for this tab. */
function AddNodeDialog({ onOpenChange, onSubmit }: AddNodeDialogProps) {
  const t = useTranslations("knowledge.graph");
  const [label, setLabel] = React.useState<GraphLabel>("Service");
  const [canonicalKey, setCanonicalKey] = React.useState("");
  const [canonicalName, setCanonicalName] = React.useState("");
  const [parentLabel, setParentLabel] = React.useState<GraphLabel | "">("");
  const [parentKey, setParentKey] = React.useState("");
  const [pending, setPending] = React.useState(false);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="md" closeLabel={t("closeLabel")}>
        <DialogHeader>
          <DialogTitle>{t("addNodeDialogTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setPending(true);
            void onSubmit({
              label,
              canonicalKey,
              canonicalName,
              parent:
                parentLabel && parentKey ? { label: parentLabel, canonicalKey: parentKey } : null,
              relationshipType: null,
            }).finally(() => setPending(false));
          }}
        >
          <FormField label={t("fieldEntityType")}>
            {(field) => (
              <Select value={label} onValueChange={(value) => setLabel(value as GraphLabel)}>
                <SelectTrigger {...field}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRAPH_LABELS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`entityType.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label={t("fieldCanonicalKey")} help={t("fieldCanonicalKeyHelp")}>
            {(field) => (
              <Input
                {...field}
                dir="ltr"
                value={canonicalKey}
                onChange={(event) => setCanonicalKey(event.target.value)}
                required
              />
            )}
          </FormField>
          <FormField label={t("fieldCanonicalName")}>
            {(field) => (
              <Input
                {...field}
                value={canonicalName}
                onChange={(event) => setCanonicalName(event.target.value)}
                required
              />
            )}
          </FormField>
          <FormField label={t("fieldParentLabel")} labelVariant="optional">
            {(field) => (
              <Select
                value={parentLabel}
                onValueChange={(value) => setParentLabel(value as GraphLabel)}
              >
                <SelectTrigger {...field}>
                  <SelectValue placeholder={t("noParent")} />
                </SelectTrigger>
                <SelectContent>
                  {GRAPH_LABELS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`entityType.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label={t("fieldParentKey")} labelVariant="optional">
            {(field) => (
              <Input
                {...field}
                dir="ltr"
                value={parentKey}
                onChange={(event) => setParentKey(event.target.value)}
              />
            )}
          </FormField>

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
              {t("addNodeDialogSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
