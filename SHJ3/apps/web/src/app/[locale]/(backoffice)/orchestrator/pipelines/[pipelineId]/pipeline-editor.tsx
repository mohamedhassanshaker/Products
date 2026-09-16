"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { PipelineCanvasGraph } from "@/components/patterns/pipeline-canvas/pipeline-canvas-graph.js";
import type {
  PipelineCanvas,
  PipelineDesignRow,
  PipelineEdgeRow,
  PipelineNodeRow,
  PipelineVersionHistoryEntryRow,
} from "../../../../../../modules/orchestration/ports/pipeline-repository.js";
import type { PipelineNodeFormValue } from "@/components/patterns/pipeline-canvas/pipeline-node-inspector.js";
import {
  analyzeCanvas,
  invalidEdgeIdsFrom,
  invalidNodeReasonsFrom,
  toPipelineCanvasModel,
} from "./pipeline-canvas-mapping.js";
import { PipelineFindingsPanel } from "./pipeline-findings-panel.js";
import { PipelineVersionBar } from "./pipeline-version-bar.js";
import { PipelineNodeDialog, type PipelineAgentOption } from "./pipeline-node-dialog.js";
import { PipelineEdgeDialog, type PipelineEdgeDialogValue } from "./pipeline-edge-dialog.js";
import {
  createPipelineEdgeAction,
  createPipelineNodeAction,
  deletePipelineEdgeAction,
  deletePipelineNodeAction,
  publishPipelineVersionAction,
  rollbackPipelineVersionAction,
  setActivePipelineVersionAction,
  updatePipelineEdgeAction,
  updatePipelineNodeAction,
} from "../actions.js";

export interface PipelineEditorProps {
  design: PipelineDesignRow;
  canvas: PipelineCanvas;
  activePipelineVersionId: string | null;
  agents: readonly PipelineAgentOption[];
  publishedAgentIds: readonly string[];
  versionHistory: readonly PipelineVersionHistoryEntryRow[];
  canPublish: boolean;
}

/**
 * The Pipeline Designer's real, interactive editor — one `PipelineCanvasGraph`, a version
 * bar (publish/activate), and a findings panel (`analyzePipelineGraph`, recomputed on every
 * change — the identical rule set the server publish gate enforces, so the two can never
 * disagree). Mutations optimistically re-fetch nothing: every write action returns the
 * full updated row, applied directly into local state, so the canvas never has a stale
 * frame between a save and the next render.
 */
export function PipelineEditor({
  design,
  canvas: initialCanvas,
  activePipelineVersionId,
  agents,
  publishedAgentIds,
  versionHistory,
  canPublish,
}: PipelineEditorProps): React.ReactElement {
  const t = useTranslations("orchestrator.pipeline.editor");
  const [canvas, setCanvas] = React.useState<PipelineCanvas>(initialCanvas);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | undefined>(undefined);
  const [nodeDialogOpen, setNodeDialogOpen] = React.useState(false);
  const [selectedEdgeId, setSelectedEdgeId] = React.useState<string | undefined>(undefined);
  const [edgeDialogOpen, setEdgeDialogOpen] = React.useState(false);
  const [edgeError, setEdgeError] = React.useState<string | undefined>(undefined);
  const [publishing, setPublishing] = React.useState(false);
  const [activating, setActivating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  const publishedAgentIdSet = React.useMemo(() => new Set(publishedAgentIds), [publishedAgentIds]);
  const findings = React.useMemo(
    () => analyzeCanvas(canvas, publishedAgentIdSet),
    [canvas, publishedAgentIdSet],
  );
  const invalidNodeReasons = React.useMemo(() => invalidNodeReasonsFrom(findings), [findings]);
  const invalidEdgeIds = React.useMemo(() => invalidEdgeIdsFrom(findings), [findings]);
  const model = React.useMemo(() => {
    const agentNameById = new Map(agents.map((a) => [a.agentId, a.name]));
    return toPipelineCanvasModel(canvas, agentNameById);
  }, [canvas, agents]);

  const selectedNode = canvas.nodes.find((n) => n.id === selectedNodeId);
  const selectedEdge = canvas.edges.find((e) => e.id === selectedEdgeId);
  const nextOrdinal = (fromNodeId: string) =>
    canvas.edges.filter((e) => e.fromNodeId === fromNodeId).length;

  function replaceNode(node: PipelineNodeRow) {
    setCanvas((prev) => ({
      ...prev,
      nodes: prev.nodes.some((n) => n.id === node.id)
        ? prev.nodes.map((n) => (n.id === node.id ? node : n))
        : [...prev.nodes, node],
    }));
  }
  function removeNode(id: string) {
    setCanvas((prev) => ({
      nodes: prev.nodes.filter((n) => n.id !== id),
      edges: prev.edges.filter((e) => e.fromNodeId !== id && e.toNodeId !== id),
      version: prev.version,
    }));
  }
  function replaceEdge(edge: PipelineEdgeRow) {
    setCanvas((prev) => ({
      ...prev,
      edges: prev.edges.some((e) => e.id === edge.id)
        ? prev.edges.map((e) => (e.id === edge.id ? edge : e))
        : [...prev.edges, edge],
    }));
  }
  function removeEdge(id: string) {
    setCanvas((prev) => ({ ...prev, edges: prev.edges.filter((e) => e.id !== id) }));
  }

  const isDraft = canvas.version.status === "Draft";

  async function handleAddAgent(agentId: string, x: number, y: number) {
    if (!isDraft) return;
    const agent = agents.find((a) => a.agentId === agentId);
    const result = await createPipelineNodeAction({
      pipelineVersionId: canvas.version.id,
      kind: "Agent",
      title: agent?.name ?? agentId,
      canvasX: Math.round(x),
      canvasY: Math.round(y),
      agentId,
      usesTurnBoundAgent: false,
      agentVersionPinId: null,
      inputContextMode: "UserTurnOnly",
      isOwningEntity: false,
      onErrorPolicy: "FailTurn",
    });
    if (result.ok) replaceNode(result.value);
  }

  async function handleAddTurnBoundAgent(x: number, y: number) {
    if (!isDraft) return;
    const result = await createPipelineNodeAction({
      pipelineVersionId: canvas.version.id,
      kind: "Agent",
      title: t("turnBoundAgentTitle"),
      canvasX: Math.round(x),
      canvasY: Math.round(y),
      agentId: null,
      usesTurnBoundAgent: true,
      agentVersionPinId: null,
      inputContextMode: "UserTurnOnly",
      isOwningEntity: true,
      onErrorPolicy: "FailTurn",
    });
    if (result.ok) replaceNode(result.value);
  }

  async function handleAddResponse(x: number, y: number) {
    if (!isDraft) return;
    const result = await createPipelineNodeAction({
      pipelineVersionId: canvas.version.id,
      kind: "Response",
      title: t("responseNodeTitle"),
      canvasX: Math.round(x),
      canvasY: Math.round(y),
      agentId: null,
      usesTurnBoundAgent: false,
      agentVersionPinId: null,
      inputContextMode: "UserTurnOnly",
      isOwningEntity: true,
      onErrorPolicy: "FailTurn",
    });
    if (result.ok) replaceNode(result.value);
  }

  async function handleNodeMove(nodeId: string, x: number, y: number): Promise<boolean> {
    const result = await updatePipelineNodeAction({
      id: nodeId,
      pipelineVersionId: canvas.version.id,
      canvasX: x,
      canvasY: y,
    });
    if (result.ok) {
      replaceNode(result.value);
      return true;
    }
    return false;
  }

  async function handleConnectNodes(fromNodeId: string, toNodeId: string) {
    const result = await createPipelineEdgeAction({
      pipelineVersionId: canvas.version.id,
      fromNodeId,
      toNodeId,
      kind: "Sequential",
      ordinal: nextOrdinal(fromNodeId),
      label: null,
      maxIterations: null,
      conditionExpression: null,
    });
    if (result.ok && result.value.ok) {
      replaceEdge(result.value.edge);
      setSelectedEdgeId(result.value.edge.id);
      setEdgeDialogOpen(true);
    }
  }

  function handleSelectNode(id: string) {
    setSelectedNodeId(id);
  }
  function handleActivateNode(id: string) {
    setSelectedNodeId(id);
    setNodeDialogOpen(true);
  }
  function handleEdgeClick(id: string) {
    setSelectedEdgeId(id);
    setEdgeDialogOpen(true);
  }

  async function handleSaveNode(value: PipelineNodeFormValue) {
    if (!selectedNode) return;
    setSaving(true);
    const inputContextMode =
      value.inputContextMode === "UserTurnOnly" ||
      value.inputContextMode === "UpstreamRepliesFull" ||
      value.inputContextMode === "UpstreamRepliesSummary"
        ? value.inputContextMode
        : undefined;
    const onErrorPolicy =
      value.onErrorPolicy === "FailTurn" ||
      value.onErrorPolicy === "SkipNode" ||
      value.onErrorPolicy === "RouteToFallbackAgent"
        ? value.onErrorPolicy
        : undefined;
    const result = await updatePipelineNodeAction({
      id: selectedNode.id,
      pipelineVersionId: canvas.version.id,
      ...(typeof value.title === "string" ? { title: value.title } : {}),
      ...(typeof value.agentId === "string"
        ? { agentId: value.agentId === "" ? null : value.agentId }
        : {}),
      ...(typeof value.usesTurnBoundAgent === "boolean"
        ? { usesTurnBoundAgent: value.usesTurnBoundAgent }
        : {}),
      ...(inputContextMode !== undefined ? { inputContextMode } : {}),
      ...(typeof value.isOwningEntity === "boolean" ? { isOwningEntity: value.isOwningEntity } : {}),
      ...(onErrorPolicy !== undefined ? { onErrorPolicy } : {}),
    });
    setSaving(false);
    if (result.ok) {
      replaceNode(result.value);
      setNodeDialogOpen(false);
    }
  }

  async function handleDeleteNode() {
    if (!selectedNode) return;
    await deletePipelineNodeAction(selectedNode.id, canvas.version.id);
    removeNode(selectedNode.id);
    setNodeDialogOpen(false);
  }

  async function handleSaveEdge(value: PipelineEdgeDialogValue) {
    if (!selectedEdge) return;
    setSaving(true);
    setEdgeError(undefined);
    const result = await updatePipelineEdgeAction({
      id: selectedEdge.id,
      pipelineVersionId: canvas.version.id,
      kind: value.kind,
      label: value.label.trim() === "" ? null : value.label.trim(),
      maxIterations: value.maxIterations,
      conditionExpression: value.conditionExpression,
    });
    setSaving(false);
    if (!result.ok) {
      setEdgeError(result.error);
      return;
    }
    if (!result.value.ok) {
      setEdgeError(result.value.reason);
      return;
    }
    replaceEdge(result.value.edge);
    setEdgeDialogOpen(false);
  }

  async function handleDeleteEdge() {
    if (!selectedEdge) return;
    await deletePipelineEdgeAction(selectedEdge.id, canvas.version.id);
    removeEdge(selectedEdge.id);
    setEdgeDialogOpen(false);
  }

  async function handlePublish() {
    setPublishing(true);
    const result = await publishPipelineVersionAction({
      pipelineVersionId: canvas.version.id,
      changeSummary: null,
    });
    setPublishing(false);
    if (result.ok && result.value.ok) {
      setCanvas((prev) => ({
        ...prev,
        version: { ...prev.version, status: "Published", isCurrent: true },
      }));
    }
  }

  async function handleSetActive() {
    setActivating(true);
    await setActivePipelineVersionAction(canvas.version.id);
    setActivating(false);
    window.location.reload();
  }

  async function handleClearActive() {
    setActivating(true);
    await setActivePipelineVersionAction(null);
    setActivating(false);
    window.location.reload();
  }

  async function handleRollback(targetVersionId: string) {
    const result = await rollbackPipelineVersionAction({
      pipelineDesignId: design.id,
      targetVersionId,
    });
    if (result.ok && result.value.ok) window.location.reload();
  }

  return (
    <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">{design.name}</h2>
        <button
          type="button"
          onClick={() => setHistoryOpen((open) => !open)}
          className="text-xs text-primary underline-offset-4 hover:underline"
        >
          {historyOpen ? t("hideHistory") : t("showHistory")}
        </button>
      </div>
      {historyOpen ? (
        <ul className="flex flex-col border border-border bg-card text-xs" style={{ borderRadius: "var(--radius-md)", padding: "var(--space-2)", gap: "var(--space-1)" }}>
          {versionHistory.length === 0 ? (
            <li className="text-muted-foreground">{t("noHistory")}</li>
          ) : (
            versionHistory.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground">{entry.kind}</span> — {entry.note}
                </span>
                {entry.kind === "Published" &&
                entry.pipelineVersionId !== null &&
                entry.pipelineVersionId !== canvas.version.id ? (
                  <button
                    type="button"
                    onClick={() => handleRollback(entry.pipelineVersionId!)}
                    className="shrink-0 text-primary underline-offset-4 hover:underline"
                  >
                    {t("rollbackAction")}
                  </button>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
      <PipelineVersionBar
        version={canvas.version}
        isActive={activePipelineVersionId === canvas.version.id}
        canPublish={canPublish}
        publishing={publishing}
        activating={activating}
        onPublish={handlePublish}
        onSetActive={handleSetActive}
        onClearActive={handleClearActive}
        blockingFindingCount={findings.filter((f) => f.severity === "blocking").length}
      />
      <PipelineFindingsPanel
        findings={findings}
        onSelectNode={handleSelectNode}
        onSelectEdge={handleEdgeClick}
      />
      <PipelineCanvasGraph
        model={model}
        variant={isDraft ? "edit" : "readonly"}
        selectedNodeId={selectedNodeId}
        onSelectedNodeChange={setSelectedNodeId}
        onActivateNode={handleActivateNode}
        invalidNodeReasons={invalidNodeReasons}
        invalidEdgeIds={invalidEdgeIds}
        onNodeMove={handleNodeMove}
        onConnectNodes={handleConnectNodes}
        onEdgeClick={handleEdgeClick}
        agents={agents}
        onAddAgent={handleAddAgent}
        onAddTurnBoundAgent={handleAddTurnBoundAgent}
        onAddResponse={handleAddResponse}
      />
      <PipelineNodeDialog
        open={nodeDialogOpen}
        onOpenChange={setNodeDialogOpen}
        node={selectedNode}
        agents={agents}
        onSave={handleSaveNode}
        onDelete={handleDeleteNode}
        saving={saving}
      />
      <PipelineEdgeDialog
        open={edgeDialogOpen}
        onOpenChange={setEdgeDialogOpen}
        edge={selectedEdge}
        knownNodeKeys={canvas.nodes.map((n) => n.key)}
        onSave={handleSaveEdge}
        onDelete={handleDeleteEdge}
        saving={saving}
        error={edgeError}
      />
    </div>
  );
}
