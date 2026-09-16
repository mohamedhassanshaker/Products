"use client";

/**
 * B3 step 6 — Flows. The real authoring layer B-5's execution engine
 * (`apps/ai/src/shj3_ai/application/execute_flow.py`) has run against since it shipped, but
 * nothing in `apps/web` had ever built until now — confirmed by `modules/flows/` not
 * existing before this pass.
 *
 * ## One flow per agent version, not a multi-flow authoring surface
 *
 * `AgentFlowBinding` (`modules/agents/ports/agent-bindings-repository.ts`) technically
 * allows an agent version to bind more than one `Flow`, ordered by `ordinal` — but nothing
 * in this wave's brief or the wireframe (`docs/shj3-wireframes.html#screen-flow`) shows a
 * multi-flow authoring UI, and B-3's own wizard has no other step that manages an ordered
 * list of anything comparable. This step resolves (creating if none exists yet) exactly ONE
 * flow per agent version — via `loadFlowsStepDataAction`, which reads this version's real
 * `AgentFlowBinding`s and takes the first — and authors that flow's canvas. A second bound
 * flow (created some other way) is left untouched and simply not surfaced here; flagged as a
 * real, deliberate scope boundary rather than silently dropped.
 *
 * ## Canvas vs. list — the same judgment call `knowledge/graph-tab.tsx` already made
 *
 * `components/patterns/flow-canvas/` already ships a real, tested, accessible interactive
 * grid canvas (`FlowCanvas`) with a per-type `NodeInspector`. It was NOT reused here: its
 * `NodeInspectorFormValue` union (`{type:"tool-call", toolName: string, argumentsJson:
 * string}`, etc. — a UI-only shape, its own doc comment says so explicitly: "no tool
 * registry or flow-persistence API exists yet... the form *shapes* ... are genuinely
 * functional now, not stubs") does not carry the real `FlowNodes` columns this authoring
 * layer must persist (`slotName`/`optionSourceKind` for Question, `retryCount`/
 * `onFailureNodeId` for ToolCall, the closed `handoverReason` set, ...), and `FlowCanvas`
 * does not expose a way to swap its inspector for a schema-accurate one. Reusing it would
 * mean either extending a shared, already-tested pattern component's public contract under
 * this pass's own time budget, or silently under-authoring real required fields to fit its
 * shape. Neither is the honest choice `graph-tab.tsx`'s own doc comment already modelled for
 * this exact situation ("no layout service exists... the list view needs no coordinates to
 * be useful, and matches this wave's own instruction not to over-invest in graph
 * visualisation for a backoffice tool") — so this step uses `DataTable` (mandatory for any
 * list rendering, `scripts/gates/no-raw-table.mjs`) plus real `Dialog` forms with the exact
 * `CK_FlowNodes_*`/`CK_FlowEdges_*` fields, the same shape `ToolsStep`/`graph-tab.tsx`'s own
 * `AddNodeDialog` already establish for this codebase. `FLOW_NODE_TYPE_META` (icon + colour
 * token per type, design-system.md §5.5 #45's exact mapping) IS reused from
 * `components/patterns/flow-canvas` — a pure, presentational, already-tested export — for
 * visual consistency with that canvas without touching or depending on its mismatched form
 * layer. `canvasX`/`canvasY` (real, non-null columns) are written as a simple deterministic
 * grid position at creation time and never read back for layout, the same "a real value the
 * UI doesn't need to be clever about" scope call.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { LogIn, LogOut, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChipInput } from "@/components/ui/chip-input";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Icon } from "@/components/ui/icon";
import { StatusCell } from "@/components/ui/status-cell";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ChatThread } from "@/components/patterns/chat-thread/chat-thread";
import type { ChatTurn } from "@/components/patterns/chat-thread/chat-thread-types";
import { Composer } from "@/components/patterns/composer/composer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/patterns/data-table/data-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/patterns/dialog";
import {
  FLOW_NODE_TYPE_META,
  FlowCanvas,
  type FlowCanvasView,
} from "@/components/patterns/flow-canvas";
import type { ColumnDef } from "@tanstack/react-table";
import {
  FLOW_NODE_HANDOVER_REASONS,
  FLOW_NODE_TYPES,
  FLOW_REQUIRED_ASSURANCE_LEVELS,
  OPTION_SOURCE_KINDS,
  type FlowNodeFields,
  type FlowNodeHandoverReason,
  type FlowNodeType,
  type FlowRequiredAssuranceLevel,
  type OptionSourceKind,
} from "../../../../../../../modules/flows/domain/flow-node.js";
import {
  CANVAS_KEY_NODE_TYPE,
  NODE_TYPE_CANVAS_KEY,
  buildFlowCanvasModel,
} from "./flow-canvas-mapping.js";
import type {
  FlowEdgeRow,
  FlowNodeRow,
  FlowVersionRow,
} from "../../../../../../../modules/flows/ports/flow-repository.js";
import type { FlowEditOperation } from "../../../../../../../modules/flows/ports/flow-edit-ai-client.js";
import type { SkillCatalogRow } from "../../../../../../../modules/tools/application/list-skills.js";
import type {
  McpServerRow,
  McpToolRow,
} from "../../../../../../../modules/tools/ports/mcp-server-repository.js";
import type { ApiConnectorCatalogRow } from "../../../../../../../modules/tools/application/list-api-connectors.js";
import type { ToolBindingRow } from "../../../../../../../modules/tools/ports/tool-binding-repository.js";
import type {
  applyFlowEditPlanAction,
  createFlowEdgeAction,
  createFlowNodeAction,
  deleteFlowEdgeAction,
  deleteFlowNodeAction,
  loadFlowsStepDataAction,
  proposeFlowEditAction,
  setEntryNodeAction,
  setEscapeNodeAction,
  updateFlowEdgeAction,
  updateFlowNodeAction,
} from "../../../actions.js";

export interface FlowsStepProps {
  readonly agentVersionId: string;
  readonly ownerTenantId: string;
  readonly agentName: string;
  readonly toolBindings: readonly ToolBindingRow[];
  readonly skills: readonly SkillCatalogRow[];
  readonly mcpServers: readonly McpServerRow[];
  readonly mcpToolsByServer: Readonly<Record<string, readonly McpToolRow[]>>;
  readonly apiConnectors: readonly ApiConnectorCatalogRow[];
  readonly loadFlowsStepData: typeof loadFlowsStepDataAction;
  readonly createFlowNode: typeof createFlowNodeAction;
  readonly updateFlowNode: typeof updateFlowNodeAction;
  readonly deleteFlowNode: typeof deleteFlowNodeAction;
  readonly createFlowEdge: typeof createFlowEdgeAction;
  readonly updateFlowEdge: typeof updateFlowEdgeAction;
  readonly deleteFlowEdge: typeof deleteFlowEdgeAction;
  readonly setEntryNode: typeof setEntryNodeAction;
  readonly setEscapeNode: typeof setEscapeNodeAction;
  readonly proposeFlowEdit: typeof proposeFlowEditAction;
  readonly applyFlowEditPlan: typeof applyFlowEditPlanAction;
  readonly onNodesChange: (hasAny: boolean) => void;
}

/** A bound tool's real display name — mirrors `ToolsStep`'s own `targetIdOf` reasoning for recovering which of `skillId`/`mcpToolId`/`apiConnectorId` a binding's `targetKind` says is populated, then resolves that id against the same catalogues `ToolsStep` already renders. */
function toolBindingLabel(
  binding: ToolBindingRow,
  skills: readonly SkillCatalogRow[],
  mcpServers: readonly McpServerRow[],
  mcpToolsByServer: Readonly<Record<string, readonly McpToolRow[]>>,
  apiConnectors: readonly ApiConnectorCatalogRow[],
): string {
  if (binding.targetKind === "Skill") {
    return skills.find((s) => s.id === binding.skillId)?.name ?? binding.skillId ?? binding.id;
  }
  if (binding.targetKind === "McpTool") {
    for (const server of mcpServers) {
      const tool = (mcpToolsByServer[server.id] ?? []).find((t) => t.id === binding.mcpToolId);
      if (tool) return `${server.name} — ${tool.name}`;
    }
    return binding.mcpToolId ?? binding.id;
  }
  return (
    apiConnectors.find((c) => c.id === binding.apiConnectorId)?.name ??
    binding.apiConnectorId ??
    binding.id
  );
}

/** A deterministic, simple grid position for a newly-created node — `canvasX`/`canvasY` are real, non-null columns; a freshly created node lands here and the user repositions it by dragging on the graphical canvas (`FlowCanvasGraph`'s own `onNodeMove`), which persists the drag via `updateFlowNode`. */
function nextGridPosition(existingCount: number): { canvasX: number; canvasY: number } {
  const columns = 4;
  return {
    canvasX: (existingCount % columns) * 240,
    canvasY: Math.floor(existingCount / columns) * 160,
  };
}

/**
 * The real fix for a confirmed, live bug: `EdgeFormDialog` used to default every new edge's
 * `ordinal` to a flat `0` with no auto-increment, so a second edge out of the same source node
 * raised a raw 500 (`UQ_FlowEdges_from_ordinal`'s unique constraint on
 * `[flowVersionId, fromNodeId, ordinal]`). Computes the next free ordinal for a given source
 * node from the real, live `edges` list — used both by the drag-to-connect path (a fresh
 * `fromNodeId` the user just wired via the graphical canvas) and the pre-existing manual "Add
 * edge" path, one shared fix rather than two independently-drifting ones.
 */
function nextOrdinalForSource(edges: readonly FlowEdgeRow[], fromNodeId: string): number {
  const existing = edges.filter((e) => e.fromNodeId === fromNodeId).map((e) => e.ordinal);
  return existing.length > 0 ? Math.max(...existing) + 1 : 0;
}

export function FlowsStep({
  agentVersionId,
  ownerTenantId,
  agentName,
  toolBindings,
  skills,
  mcpServers,
  mcpToolsByServer,
  apiConnectors,
  loadFlowsStepData,
  createFlowNode,
  updateFlowNode,
  deleteFlowNode,
  createFlowEdge,
  updateFlowEdge,
  deleteFlowEdge,
  setEntryNode,
  setEscapeNode,
  proposeFlowEdit,
  applyFlowEditPlan,
  onNodesChange,
}: FlowsStepProps): React.ReactElement {
  const t = useTranslations("agents.wizard.flows");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [flowVersionId, setFlowVersionId] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState<FlowVersionRow | null>(null);
  const [nodes, setNodes] = React.useState<readonly FlowNodeRow[]>([]);
  const [edges, setEdges] = React.useState<readonly FlowEdgeRow[]>([]);
  const [nodeDialog, setNodeDialog] = React.useState<{
    node: FlowNodeRow | null;
    initialType?: FlowNodeType;
  } | null>(null);
  const [edgeDialog, setEdgeDialog] = React.useState<{
    edge: FlowEdgeRow | null;
    initialFromNodeId?: string;
    initialToNodeId?: string;
  } | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  /** The AI flow-editing sidebar (product owner's request: business-language edits, human-reviewed before anything is written — see `modules/flows/ports/flow-edit-ai-client.ts`'s doc comment). Show/hide, not a separate route: the flow author stays on the same canvas throughout. */
  const [aiSidebarOpen, setAiSidebarOpen] = React.useState(false);
  const [aiChatTurns, setAiChatTurns] = React.useState<readonly ChatTurn[]>([]);
  const [aiComposerValue, setAiComposerValue] = React.useState("");
  const [aiProposing, setAiProposing] = React.useState(false);
  /** The most recently proposed plan awaiting review — `accepted` holds the indices (into `operations`) the staff user currently has checked, default all-checked. Cleared on apply, reject, or a new propose call. */
  const [aiPendingPlan, setAiPendingPlan] = React.useState<{
    readonly operations: readonly FlowEditOperation[];
    readonly accepted: ReadonlySet<number>;
  } | null>(null);
  const [aiApplying, setAiApplying] = React.useState(false);
  /**
   * Lifted from `FlowCanvas`'s own internal toggle (review-comments-3: "in canvas mode hide
   * connection parts") — Canvas view shows the compact node-action row below the canvas
   * (edges are edited by clicking them directly, `onEdgeClick` below); Outline view has no
   * interactive canvas at all, so it keeps the full Connections table instead. Selecting a
   * node while in Outline view already switches back to Canvas view on its own
   * (`FlowCanvasGraph`'s own outline-select handler), so nothing needs a node-action bar in
   * Outline view either.
   */
  const [canvasView, setCanvasView] = React.useState<FlowCanvasView>("canvas");
  /** The node currently selected on the graphical canvas (`FlowCanvas`'s own `selectedNodeId`/`onSelectedNodeChange`) — drives the compact node-action row below it. */
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | undefined>(undefined);
  const selectedNode = React.useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );
  /** The real domain ↔ presentational mapping (`flow-canvas-mapping.ts`) — the one bridge both `FlowCanvas`-rendering entry points build from live `nodes`/`edges` state. */
  const canvasModel = React.useMemo(() => buildFlowCanvasModel(nodes, edges), [nodes, edges]);

  const boundTools = React.useMemo(
    () =>
      toolBindings
        .filter((b) => b.isEnabled)
        .map((b) => ({
          id: b.id,
          label: toolBindingLabel(b, skills, mcpServers, mcpToolsByServer, apiConnectors),
        })),
    [toolBindings, skills, mcpServers, mcpToolsByServer, apiConnectors],
  );

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = await loadFlowsStepData({
        agentVersionId,
        ownerTenantId,
        newFlowName: `${agentName} flow`,
      });
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFlowVersionId(result.value.flowVersionId);
      setVersion(result.value.version);
      setNodes(result.value.nodes);
      setEdges(result.value.edges);
    })();
    return () => {
      cancelled = true;
    };
    // Runs once on mount, matching `GraphTab`'s identical single-load pattern — see that
    // file's own note on why no `react-hooks/exhaustive-deps` suppression is needed here.
  }, []);

  React.useEffect(() => {
    onNodesChange(nodes.length > 0);
  }, [nodes.length]);

  function nodeTitle(id: string | null): string {
    if (!id) return t("none");
    return nodes.find((n) => n.id === id)?.title ?? id;
  }

  async function handleSetEntry(nodeId: string): Promise<void> {
    if (!flowVersionId) return;
    setPendingId(nodeId);
    const result = await setEntryNode({ flowVersionId, nodeId });
    setPendingId(null);
    if (!result.ok) return setError(result.error);
    setVersion((v) => (v ? { ...v, entryNodeId: nodeId } : v));
  }

  async function handleSetEscape(nodeId: string): Promise<void> {
    if (!flowVersionId) return;
    setPendingId(nodeId);
    const result = await setEscapeNode({ flowVersionId, nodeId });
    setPendingId(null);
    if (!result.ok) return setError(result.error);
    setVersion((v) => (v ? { ...v, escapeNodeId: nodeId, freeTextEscapeEnabled: true } : v));
  }

  /**
   * The AI sidebar's "propose" turn. Sends the instruction plus the thread's own prior
   * user/assistant turns (a real, small conversational memory — `apps/ai`'s own
   * `_SYSTEM_PROMPT_TEMPLATE` also carries the live node/edge snapshot, so this history is
   * only for "what did we just discuss," not the flow's own state). Never applies anything —
   * a returned plan sits in `aiPendingPlan` until the staff user explicitly applies or
   * rejects it below.
   */
  async function handleAiSend(): Promise<void> {
    const instruction = aiComposerValue.trim();
    if (!instruction || !flowVersionId) return;

    const userTurn: ChatTurn = {
      id: crypto.randomUUID(),
      role: "user",
      text: instruction,
      timestamp: new Date(),
    };
    const history = aiChatTurns
      .filter((turn) => turn.role === "user" || turn.role === "assistant")
      .map((turn) => ({ role: turn.role as "user" | "assistant", text: turn.text }));

    setAiChatTurns((current) => [...current, userTurn]);
    setAiComposerValue("");
    setAiProposing(true);
    setAiPendingPlan(null);

    const result = await proposeFlowEdit({
      flowVersionId,
      instruction,
      conversationHistory: history,
    });
    setAiProposing(false);

    if (!result.ok) {
      setAiChatTurns((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "system", note: result.error, timestamp: new Date() },
      ]);
      return;
    }

    // The model is explicitly instructed (`_SYSTEM_PROMPT_TEMPLATE`, apps/ai) to explain
    // itself in `planSummary` precisely when it proposes zero operations — e.g. "this
    // reads like reference content for a knowledge source, not a concrete flow edit."
    // Discarding that in favor of a generic string throws away real, model-specific
    // guidance the user could act on (rephrase the instruction, use Knowledge instead).
    const assistantText =
      result.operations.length > 0
        ? result.planSummary || t("aiPlanReadyFallback")
        : result.planSummary || t("aiNoChangesProposed");
    const nextTurns: ChatTurn[] = [
      ...aiChatTurns,
      userTurn,
      { id: crypto.randomUUID(), role: "assistant", text: assistantText, timestamp: new Date() },
    ];
    if (result.warnings.length > 0) {
      nextTurns.push({
        id: crypto.randomUUID(),
        role: "system",
        note: result.warnings.join(" "),
        timestamp: new Date(),
      });
    }
    setAiChatTurns(nextTurns);
    if (result.operations.length > 0) {
      setAiPendingPlan({
        operations: result.operations,
        accepted: new Set(result.operations.keys()),
      });
    }
  }

  function handleAiToggleOperation(index: number): void {
    setAiPendingPlan((current) => {
      if (!current) return current;
      const accepted = new Set(current.accepted);
      if (accepted.has(index)) accepted.delete(index);
      else accepted.add(index);
      return { ...current, accepted };
    });
  }

  function handleAiRejectPlan(): void {
    setAiPendingPlan(null);
    setAiChatTurns((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "system", note: t("aiPlanRejected"), timestamp: new Date() },
    ]);
  }

  /**
   * The one real write path this sidebar ever triggers — `applyFlowEditPlanAction`, which
   * itself executes through the same application-layer classes `createFlowNodeAction`/etc.
   * use (`agents/actions.ts`'s own doc comment on that action). Only the checked operations
   * are sent; an unchecked `CreateNode` whose placeholder id a later checked operation still
   * references is this wave's one named, accepted risk (see the approved plan's "Wave 3B"
   * note) — the review list defaults every operation to checked precisely to keep this rare.
   */
  async function handleAiApplyPlan(): Promise<void> {
    if (!aiPendingPlan || !flowVersionId) return;
    const acceptedOps = [...aiPendingPlan.operations.entries()]
      .filter(([index]) => aiPendingPlan.accepted.has(index))
      .map(([, op]) => op);
    if (acceptedOps.length === 0) {
      setAiPendingPlan(null);
      return;
    }
    setAiApplying(true);
    const result = await applyFlowEditPlan({ flowVersionId, operations: acceptedOps });
    setAiApplying(false);

    if (!result.ok) {
      const detail = "error" in result ? result.error : result.detail;
      setAiChatTurns((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "system",
          note: t("aiApplyFailed", { detail }),
          timestamp: new Date(),
        },
      ]);
      return;
    }

    setNodes(result.nodes);
    setEdges(result.edges);
    setAiPendingPlan(null);
    setSelectedNodeId(undefined);
    setAiChatTurns((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "system",
        note: t("aiApplied", { count: result.appliedCount }),
        timestamp: new Date(),
      },
    ]);
  }

  async function handleDeleteNode(node: FlowNodeRow): Promise<void> {
    if (!flowVersionId) return;
    setPendingId(node.id);
    const result = await deleteFlowNode({ id: node.id, flowVersionId });
    setPendingId(null);
    if (!result.ok) return setError(result.error);
    setNodes((current) => current.filter((n) => n.id !== node.id));
    setEdges((current) =>
      current.filter((e) => e.fromNodeId !== node.id && e.toNodeId !== node.id),
    );
    setSelectedNodeId((current) => (current === node.id ? undefined : current));
  }

  async function handleDeleteEdge(edge: FlowEdgeRow): Promise<void> {
    if (!flowVersionId) return;
    setPendingId(edge.id);
    const result = await deleteFlowEdge({ id: edge.id, flowVersionId });
    setPendingId(null);
    if (!result.ok) return setError(result.error);
    setEdges((current) => current.filter((e) => e.id !== edge.id));
  }

  async function handleNodeSubmit(
    fields: FlowNodeFields,
    editing: FlowNodeRow | null,
  ): Promise<readonly string[] | null> {
    if (!flowVersionId) return [t("noFlowVersion")];
    setError(null);
    if (editing) {
      const result = await updateFlowNode({ id: editing.id, flowVersionId, ...fields });
      if (!result.ok) {
        return result.reason === "flows.invalid_node"
          ? result.errors
          : [t(`reason.${result.reason}`, { defaultValue: result.reason })];
      }
      setNodes((current) => current.map((n) => (n.id === editing.id ? result.node : n)));
      setNodeDialog(null);
      return null;
    }
    const position = nextGridPosition(nodes.length);
    const result = await createFlowNode({ flowVersionId, ...fields, ...position });
    if (!result.ok) {
      return result.errors;
    }
    setNodes((current) => [...current, result.node]);
    setNodeDialog(null);
    return null;
  }

  async function handleEdgeSubmit(
    fields: {
      fromNodeId: string;
      toNodeId: string;
      label: string | null;
      ordinal: number;
      conditionExpression: string | null;
      isDefaultBranch: boolean;
    },
    editing: FlowEdgeRow | null,
  ): Promise<readonly string[] | null> {
    if (!flowVersionId) return [t("noFlowVersion")];
    setError(null);
    if (editing) {
      const result = await updateFlowEdge({ id: editing.id, flowVersionId, ...fields });
      if (!result.ok) return [t(`reason.${result.reason}`, { defaultValue: result.reason })];
      setEdges((current) => current.map((e) => (e.id === editing.id ? result.edge : e)));
      setEdgeDialog(null);
      return null;
    }
    const result = await createFlowEdge({ flowVersionId, ...fields });
    if (!result.ok) {
      return result.reason === "flows.invalid_edge"
        ? result.errors
        : [t(`reason.${result.reason}`, { defaultValue: result.reason })];
    }
    setEdges((current) => [...current, result.edge]);
    setEdgeDialog(null);
    return null;
  }

  const edgeColumns = React.useMemo<ColumnDef<FlowEdgeRow, unknown>[]>(
    () => [
      {
        id: "from",
        header: t("columnFrom"),
        meta: { identifying: true },
        cell: ({ row }) => nodeTitle(row.original.fromNodeId),
      },
      {
        id: "to",
        header: t("columnTo"),
        cell: ({ row }) => nodeTitle(row.original.toNodeId),
      },
      {
        id: "label",
        accessorKey: "label",
        header: t("columnLabel"),
        cell: ({ row }) => row.original.label ?? t("none"),
      },
      {
        id: "ordinal",
        accessorKey: "ordinal",
        header: t("columnOrdinal"),
        meta: { mono: true },
      },
      {
        id: "default",
        header: t("columnDefaultBranch"),
        cell: ({ row }) =>
          row.original.isDefaultBranch ? (
            <StatusCell label={t("yes")} family="success" rank={0} />
          ) : (
            <span className="text-xs text-muted-foreground">{t("no")}</span>
          ),
      },
      {
        id: "actions",
        header: t("columnActions"),
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEdgeDialog({ edge: row.original })}
            >
              {t("editAction")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={pendingId === row.original.id}
              onClick={() => void handleDeleteEdge(row.original)}
            >
              {t("deleteAction")}
            </Button>
          </div>
        ),
      },
    ],
    [t, nodes, pendingId],
  );

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}

      <div className="flex items-center justify-between gap-4">
        <StatusCell
          label={version?.status === "Published" ? t("statusPublished") : t("statusDraft")}
          family={version?.status === "Published" ? "success" : "neutral"}
          rank={0}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-pressed={aiSidebarOpen}
          onClick={() => setAiSidebarOpen((open) => !open)}
        >
          {aiSidebarOpen ? t("aiSidebarHideAction") : t("aiSidebarShowAction")}
        </Button>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
      <div className="flex flex-col gap-3">
        {/* The real graphical canvas (`design-system.md` §5.5 #45) replacing the old node
            table — real, already-tested, framework-agnostic, wired to live data via
            `flow-canvas-mapping.ts`. `onActivateNode` opens the REAL, schema-accurate
            `NodeFormDialog` below (identical to the old table's "Edit" action) rather than
            the canvas's own generic inspector — see `flow-canvas-mapping.ts`'s module doc
            comment for why. */}
        <FlowCanvas
          model={canvasModel}
          {...(selectedNodeId !== undefined ? { selectedNodeId } : {})}
          onSelectedNodeChange={setSelectedNodeId}
          onActivateNode={(nodeId) => {
            const node = nodes.find((n) => n.id === nodeId);
            if (node) setNodeDialog({ node });
          }}
          onNodeMove={async (nodeId, canvasX, canvasY) => {
            if (!flowVersionId) return false;
            const result = await updateFlowNode({ id: nodeId, flowVersionId, canvasX, canvasY });
            if (!result.ok) return false;
            setNodes((current) => current.map((n) => (n.id === nodeId ? result.node : n)));
            return true;
          }}
          onConnectNodes={(fromNodeId, toNodeId) => {
            setEdgeDialog({ edge: null, initialFromNodeId: fromNodeId, initialToNodeId: toNodeId });
          }}
          onEdgeClick={(edgeId) => {
            const edge = edges.find((e) => e.id === edgeId);
            if (edge) setEdgeDialog({ edge });
          }}
          onRequestCreateNode={(canvasType) => {
            setNodeDialog({ node: null, initialType: CANVAS_KEY_NODE_TYPE[canvasType] });
          }}
          view={canvasView}
          onViewChange={setCanvasView}
          paletteHeading={t("canvasPaletteHeading")}
          aria-label={t("canvasAriaLabel")}
          loadingMessage={t("loading")}
          viewToggleLabel={t("canvasViewToggleLabel")}
          canvasViewLabel={t("canvasViewLabel")}
          outlineViewLabel={t("canvasOutlineViewLabel")}
          emptyHeadline={t("noNodesHeadline")}
          emptyCause={t("noNodesCause")}
        />

        {selectedNode && canvasView === "canvas" ? (
          <div
            data-slot="flow-selected-node-actions"
            className="flex flex-wrap items-center gap-2 border border-border bg-card"
            style={{ borderRadius: "var(--radius-md)", padding: "var(--space-2)" }}
          >
            {(() => {
              const meta = FLOW_NODE_TYPE_META[NODE_TYPE_CANVAS_KEY[selectedNode.type]];
              return (
                <span
                  className="flex items-center gap-1.5 text-xs font-medium"
                  style={{ color: meta.colorToken }}
                >
                  <Icon icon={meta.glyph} size={14} />
                  {selectedNode.title}
                </span>
              );
            })()}
            {version?.entryNodeId === selectedNode.id ? (
              <StatusCell label={t("entryBadge")} family="info" rank={0} />
            ) : null}
            {version?.escapeNodeId === selectedNode.id ? (
              <StatusCell label={t("escapeBadge")} family="success" rank={0} />
            ) : null}
            <div className="ms-auto flex flex-wrap items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={pendingId === selectedNode.id}
                onClick={() => void handleSetEntry(selectedNode.id)}
              >
                <Icon icon={LogIn} size={14} />
                {t("setEntryAction")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={pendingId === selectedNode.id}
                onClick={() => void handleSetEscape(selectedNode.id)}
              >
                <Icon icon={LogOut} size={14} />
                {t("setEscapeAction")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={pendingId === selectedNode.id}
                onClick={() => void handleDeleteNode(selectedNode)}
              >
                <Icon icon={Trash2} size={14} />
                {t("deleteAction")}
              </Button>
            </div>
          </div>
        ) : canvasView === "canvas" ? (
          <p className="text-xs text-muted-foreground">{t("selectNodeHint")}</p>
        ) : null}
      </div>

      {canvasView === "outline" ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-medium text-foreground">{t("edgesHeading")}</h3>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={nodes.length < 2}
              onClick={() => setEdgeDialog({ edge: null })}
            >
              {t("addEdgeAction")}
            </Button>
          </div>
          <DataTable
            columns={edgeColumns}
            data={edges}
            getRowId={(row) => row.id}
            getRowLabel={(row) => row.label ?? row.id}
            caption={t("edgesHeading")}
            captionVisuallyHidden
            status={edges.length === 0 ? "empty" : "ready"}
            emptyContent={<EmptyState headline={t("noEdgesHeadline")} cause={t("noEdgesCause")} />}
          />
        </div>
      ) : null}
      </div>

      {aiSidebarOpen ? (
        <AiFlowEditSidebar
          turns={aiChatTurns}
          composerValue={aiComposerValue}
          onComposerValueChange={setAiComposerValue}
          onSend={() => void handleAiSend()}
          proposing={aiProposing}
          pendingPlan={aiPendingPlan}
          onToggleOperation={handleAiToggleOperation}
          onApplyPlan={() => void handleAiApplyPlan()}
          onRejectPlan={handleAiRejectPlan}
          applying={aiApplying}
        />
      ) : null}
      </div>

      {nodeDialog ? (
        <NodeFormDialog
          editing={nodeDialog.node}
          {...(nodeDialog.initialType !== undefined ? { initialType: nodeDialog.initialType } : {})}
          existingNodes={nodes}
          toolOptions={boundTools}
          onOpenChange={(open) => {
            if (!open) setNodeDialog(null);
          }}
          onSubmit={(fields) => handleNodeSubmit(fields, nodeDialog.node)}
        />
      ) : null}

      {edgeDialog ? (
        <EdgeFormDialog
          editing={edgeDialog.edge}
          nodes={nodes}
          edges={edges}
          {...(edgeDialog.initialFromNodeId !== undefined
            ? { initialFromNodeId: edgeDialog.initialFromNodeId }
            : {})}
          {...(edgeDialog.initialToNodeId !== undefined
            ? { initialToNodeId: edgeDialog.initialToNodeId }
            : {})}
          onOpenChange={(open) => {
            if (!open) setEdgeDialog(null);
          }}
          onSubmit={(fields) => handleEdgeSubmit(fields, edgeDialog.edge)}
          {...(edgeDialog.edge
            ? {
                onDelete: async () => {
                  await handleDeleteEdge(edgeDialog.edge!);
                  setEdgeDialog(null);
                },
              }
            : {})}
        />
      ) : null}
    </div>
  );
}

interface AiFlowEditSidebarProps {
  readonly turns: readonly ChatTurn[];
  readonly composerValue: string;
  readonly onComposerValueChange: (value: string) => void;
  readonly onSend: () => void;
  readonly proposing: boolean;
  readonly pendingPlan: {
    readonly operations: readonly FlowEditOperation[];
    readonly accepted: ReadonlySet<number>;
  } | null;
  readonly onToggleOperation: (index: number) => void;
  readonly onApplyPlan: () => void;
  readonly onRejectPlan: () => void;
  readonly applying: boolean;
}

/**
 * B7's AI flow-editing sidebar (the product owner's own request, verbatim: "write business
 * language and ai agent will maintain flow edit or create"). Reuses the already-built,
 * already-tested `ChatThread`/`Composer` organisms for the conversation — the one genuinely
 * new piece is the operation review list below the thread: one checkbox per proposed
 * operation, default checked, nothing applied until the staff user presses "Apply".
 */
function AiFlowEditSidebar({
  turns,
  composerValue,
  onComposerValueChange,
  onSend,
  proposing,
  pendingPlan,
  onToggleOperation,
  onApplyPlan,
  onRejectPlan,
  applying,
}: AiFlowEditSidebarProps) {
  const t = useTranslations("agents.wizard.flows");
  const acceptedCount = pendingPlan ? pendingPlan.accepted.size : 0;

  return (
    <div
      data-slot="flow-ai-sidebar"
      className="flex w-full flex-col gap-3 border border-border bg-card lg:w-96 lg:flex-none"
      style={{ borderRadius: "var(--radius-lg)", padding: "var(--space-3)" }}
    >
      <h3 className="text-sm font-medium text-foreground">{t("aiSidebarHeading")}</h3>
      <p className="text-xs text-muted-foreground">{t("aiSidebarIntro")}</p>

      <ChatThread
        turns={turns}
        variant="transcript"
        state={proposing ? "thinking" : "idle"}
        aria-label={t("aiSidebarTranscriptAriaLabel")}
        emptyLabel={t("aiSidebarEmpty")}
      />

      {pendingPlan ? (
        <div
          data-slot="flow-ai-plan-review"
          className="flex flex-col gap-2 border border-border"
          style={{ borderRadius: "var(--radius-md)", padding: "var(--space-2)" }}
        >
          <span className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
            {t("aiPlanReviewHeading")}
          </span>
          <ul className="flex flex-col gap-2">
            {pendingPlan.operations.map((op, index) => (
              <li key={index} className="flex items-start gap-2">
                <Checkbox
                  checked={pendingPlan.accepted.has(index)}
                  onCheckedChange={() => onToggleOperation(index)}
                  aria-label={t(`aiOperationKind.${op.kind}`)}
                />
                <span className="flex flex-col">
                  <span className="text-xs font-medium text-foreground">
                    {t(`aiOperationKind.${op.kind}`)}
                  </span>
                  <span className="text-xs text-muted-foreground">{op.summary}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" loading={applying} onClick={onApplyPlan}>
              {t("aiApplyAction", { count: acceptedCount })}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onRejectPlan} disabled={applying}>
              {t("aiRejectAction")}
            </Button>
          </div>
        </div>
      ) : null}

      <Composer
        value={composerValue}
        onValueChange={onComposerValueChange}
        onSend={onSend}
        status={proposing ? { type: "sending" } : { type: "idle" }}
        placeholder={t("aiComposerPlaceholder")}
        ariaLabel={t("aiComposerAriaLabel")}
        sendLabel={t("aiComposerSendLabel")}
      />
    </div>
  );
}

interface NodeFormDialogProps {
  readonly editing: FlowNodeRow | null;
  /** Pre-selects the type `Select` when opened from the graphical canvas's node-creation palette (`FlowCanvasGraph`'s `onRequestCreateNode`) — ignored once `editing` is set (the type `Select` is disabled for an existing node regardless). */
  readonly initialType?: FlowNodeType;
  readonly existingNodes: readonly FlowNodeRow[];
  readonly toolOptions: readonly { readonly id: string; readonly label: string }[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (fields: FlowNodeFields) => Promise<readonly string[] | null>;
}

/** One dialog, five conditional field sets — the real `CK_FlowNodes_*` shape per type, matching `graph-tab.tsx`'s own `AddNodeDialog` precedent for a schema-accurate creation form over a generic key/value editor. */
function NodeFormDialog({
  editing,
  initialType,
  existingNodes,
  toolOptions,
  onOpenChange,
  onSubmit,
}: NodeFormDialogProps) {
  const t = useTranslations("agents.wizard.flows");
  const [type, setType] = React.useState<FlowNodeType>(editing?.type ?? initialType ?? "Message");
  const [title, setTitle] = React.useState(editing?.title ?? "");
  const [messageText, setMessageText] = React.useState(editing?.messageText ?? "");
  const [quickActionSetKey, setQuickActionSetKey] = React.useState(
    editing?.quickActionSetKey ?? "",
  );
  const [slotName, setSlotName] = React.useState(editing?.slotName ?? "");
  const [optionSourceKind, setOptionSourceKind] = React.useState<OptionSourceKind | "">(
    editing?.optionSourceKind ?? "",
  );
  const [optionSourceRef, setOptionSourceRef] = React.useState(editing?.optionSourceRef ?? "");
  /**
   * A real add/remove chip list, not a raw JSON textarea (review-comments-3: "avoid any
   * JSON ... advanced technical input"). Still serializes to/from the exact same
   * `staticOptionsJson` column `validateFlowNodeFields`'s `JSON.parse` check already
   * validates — no domain/backend change, only this dialog's own local shape.
   */
  const [staticOptions, setStaticOptions] = React.useState<string[]>(() => {
    if (!editing?.staticOptionsJson) return [];
    try {
      const parsed: unknown = JSON.parse(editing.staticOptionsJson);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  });
  const [toolBindingId, setToolBindingId] = React.useState(editing?.toolBindingId ?? "");
  const [retryCount, setRetryCount] = React.useState(editing?.retryCount ?? 1);
  const [retryOnTimeout, setRetryOnTimeout] = React.useState(editing?.retryOnTimeout ?? true);
  const [timeoutMs, setTimeoutMs] = React.useState(editing?.timeoutMs ?? 8000);
  const [onFailureNodeId, setOnFailureNodeId] = React.useState(editing?.onFailureNodeId ?? "");
  const [handoverReason, setHandoverReason] = React.useState<FlowNodeHandoverReason | "">(
    editing?.handoverReason ?? "",
  );
  const [conditionExpression, setConditionExpression] = React.useState(
    editing?.conditionExpression ?? "",
  );
  const [requiredAssurance, setRequiredAssurance] = React.useState<FlowRequiredAssuranceLevel | "">(
    editing?.requiredAssurance ?? "",
  );
  const [errors, setErrors] = React.useState<readonly string[]>([]);
  const [pending, setPending] = React.useState(false);

  const failurePathOptions = existingNodes.filter((n) => n.id !== editing?.id);

  async function submit(): Promise<void> {
    setPending(true);
    const fields: FlowNodeFields = {
      type,
      title,
      canvasX: editing?.canvasX ?? 0,
      canvasY: editing?.canvasY ?? 0,
      messageText: type === "Message" ? messageText || null : null,
      quickActionSetKey: type === "Message" ? quickActionSetKey || null : null,
      slotName: type === "Question" ? slotName || null : null,
      optionSourceKind: type === "Question" ? optionSourceKind || null : null,
      optionSourceRef: type === "Question" ? optionSourceRef || null : null,
      staticOptionsJson:
        type === "Question" && staticOptions.length > 0 ? JSON.stringify(staticOptions) : null,
      toolBindingId: type === "ToolCall" ? toolBindingId || null : null,
      retryCount: type === "ToolCall" ? retryCount : null,
      retryOnTimeout: type === "ToolCall" ? retryOnTimeout : null,
      timeoutMs: type === "ToolCall" ? timeoutMs : null,
      onFailureNodeId: type === "ToolCall" ? onFailureNodeId || null : null,
      handoverReason: type === "Handover" ? handoverReason || null : null,
      confidenceThreshold: null,
      conditionExpression: type === "Condition" ? conditionExpression || null : null,
      requiredAssurance: requiredAssurance || null,
    };
    const result = await onSubmit(fields);
    setPending(false);
    if (result) setErrors(result);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="md" closeLabel={t("closeLabel")}>
        <DialogHeader>
          <DialogTitle>{editing ? t("editNodeDialogTitle") : t("addNodeDialogTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {errors.length > 0 ? (
            <InlineAlert variant="destructive">
              <ul className="list-disc ps-4">
                {errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </InlineAlert>
          ) : null}

          <FormField label={t("fieldNodeType")}>
            {(field) => (
              <Select
                value={type}
                onValueChange={(value) => setType(value as FlowNodeType)}
                disabled={editing !== null}
              >
                <SelectTrigger {...field}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FLOW_NODE_TYPES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`nodeType.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField label={t("fieldTitle")}>
            {(field) => (
              <Input {...field} value={title} onChange={(e) => setTitle(e.target.value)} required />
            )}
          </FormField>

          {type === "Message" ? (
            <>
              <FormField label={t("fieldMessageText")}>
                {(field) => (
                  <Textarea
                    {...field}
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    rows={4}
                    required
                  />
                )}
              </FormField>
              <FormField label={t("fieldQuickActionSetKey")} labelVariant="optional">
                {(field) => (
                  <Input
                    {...field}
                    dir="ltr"
                    value={quickActionSetKey}
                    onChange={(e) => setQuickActionSetKey(e.target.value)}
                  />
                )}
              </FormField>
            </>
          ) : null}

          {type === "Question" ? (
            <>
              <FormField
                label={t("fieldSlotName")}
                labelHelp={t("fieldSlotNameHelp")}
                labelHelpAriaLabel={t("fieldSlotNameHelpAriaLabel")}
              >
                {(field) => (
                  <Input
                    {...field}
                    dir="ltr"
                    variant="mono"
                    value={slotName}
                    onChange={(e) => setSlotName(e.target.value)}
                    required
                  />
                )}
              </FormField>
              <FormField
                label={t("fieldOptionSourceKind")}
                labelHelp={t("fieldOptionSourceKindHelp")}
                labelHelpAriaLabel={t("fieldOptionSourceKindHelpAriaLabel")}
              >
                {(field) => (
                  <Select
                    value={optionSourceKind}
                    onValueChange={(value) => setOptionSourceKind(value as OptionSourceKind)}
                  >
                    <SelectTrigger {...field}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPTION_SOURCE_KINDS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {t(`optionSourceKind.${option}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              {optionSourceKind === "Static" ? (
                <FormField
                  label={t("fieldStaticOptionsJson")}
                  labelHelp={t("fieldStaticOptionsJsonHelp")}
                  labelHelpAriaLabel={t("fieldStaticOptionsJsonHelpAriaLabel")}
                >
                  {(field) => (
                    <ChipInput
                      {...field}
                      aria-label={t("fieldStaticOptionsJson")}
                      chips={staticOptions}
                      onChipsChange={setStaticOptions}
                      placeholder={t("fieldStaticOptionsJsonPlaceholder")}
                    />
                  )}
                </FormField>
              ) : null}
              {optionSourceKind === "GraphEntityLabel" || optionSourceKind === "ToolResult" ? (
                <FormField
                  label={t("fieldOptionSourceRef")}
                  labelHelp={t("fieldOptionSourceRefHelp")}
                  labelHelpAriaLabel={t("fieldOptionSourceRefHelpAriaLabel")}
                >
                  {(field) => (
                    <Input
                      {...field}
                      dir="ltr"
                      value={optionSourceRef}
                      onChange={(e) => setOptionSourceRef(e.target.value)}
                    />
                  )}
                </FormField>
              ) : null}
            </>
          ) : null}

          {type === "ToolCall" ? (
            <>
              <FormField
                label={t("fieldToolBinding")}
                labelHelp={t("fieldToolBindingHelp")}
                labelHelpAriaLabel={t("fieldToolBindingHelpAriaLabel")}
              >
                {(field) => (
                  <Select value={toolBindingId} onValueChange={setToolBindingId}>
                    <SelectTrigger {...field}>
                      <SelectValue placeholder={t("fieldToolBindingPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {toolOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              <FormField
                label={t("fieldRetryCount")}
                labelHelp={t("fieldRetryCountHelp")}
                labelHelpAriaLabel={t("fieldRetryCountHelpAriaLabel")}
              >
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    min={0}
                    max={3}
                    value={retryCount}
                    onChange={(e) => setRetryCount(Number(e.target.value))}
                  />
                )}
              </FormField>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">{t("fieldRetryOnTimeout")}</span>
                <Switch
                  checked={retryOnTimeout}
                  onCheckedChange={setRetryOnTimeout}
                  aria-label={t("fieldRetryOnTimeout")}
                />
              </div>
              <FormField label={t("fieldTimeoutMs")} labelVariant="optional">
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    min={0}
                    value={timeoutMs}
                    onChange={(e) => setTimeoutMs(Number(e.target.value))}
                  />
                )}
              </FormField>
              <FormField
                label={t("fieldOnFailureNode")}
                labelHelp={t("fieldOnFailureNodeHelp")}
                labelHelpAriaLabel={t("fieldOnFailureNodeHelpAriaLabel")}
              >
                {(field) => (
                  <Select value={onFailureNodeId} onValueChange={setOnFailureNodeId}>
                    <SelectTrigger {...field}>
                      <SelectValue placeholder={t("fieldOnFailureNodePlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {failurePathOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            </>
          ) : null}

          {type === "Handover" ? (
            <FormField
              label={t("fieldHandoverReason")}
              labelHelp={t("fieldHandoverReasonHelp")}
              labelHelpAriaLabel={t("fieldHandoverReasonHelpAriaLabel")}
            >
              {(field) => (
                <Select
                  value={handoverReason}
                  onValueChange={(value) => setHandoverReason(value as FlowNodeHandoverReason)}
                >
                  <SelectTrigger {...field}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FLOW_NODE_HANDOVER_REASONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {t(`handoverReason.${option}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          ) : null}

          {type === "Condition" ? (
            <FormField
              label={t("fieldConditionExpression")}
              labelHelp={t("fieldConditionExpressionHelp")}
              labelHelpAriaLabel={t("fieldConditionExpressionHelpAriaLabel")}
            >
              {(field) => (
                <Input
                  {...field}
                  dir="ltr"
                  variant="mono"
                  value={conditionExpression}
                  onChange={(e) => setConditionExpression(e.target.value)}
                  required
                />
              )}
            </FormField>
          ) : null}

          <FormField
            label={t("fieldRequiredAssurance")}
            labelVariant="optional"
            labelHelp={t("fieldRequiredAssuranceHelp")}
            labelHelpAriaLabel={t("fieldRequiredAssuranceHelpAriaLabel")}
          >
            {(field) => (
              <Select
                value={requiredAssurance}
                onValueChange={(value) => setRequiredAssurance(value as FlowRequiredAssuranceLevel)}
              >
                <SelectTrigger {...field}>
                  <SelectValue placeholder={t("fieldRequiredAssurancePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {FLOW_REQUIRED_ASSURANCE_LEVELS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`requiredAssurance.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              {editing ? t("saveAction") : t("addNodeDialogSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface EdgeFormDialogProps {
  readonly editing: FlowEdgeRow | null;
  readonly nodes: readonly FlowNodeRow[];
  /** The real, live edge list — needed to auto-compute the next free `ordinal` for a new edge's source node (see `nextOrdinalForSource`'s own doc comment for the bug this closes). */
  readonly edges: readonly FlowEdgeRow[];
  /** Pre-fills the From/To `Select`s when opened from the graphical canvas's drag-to-connect interaction (`FlowCanvasGraph`'s `onConnectNodes`). Ignored once `editing` is set. */
  readonly initialFromNodeId?: string;
  readonly initialToNodeId?: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (fields: {
    fromNodeId: string;
    toNodeId: string;
    label: string | null;
    ordinal: number;
    conditionExpression: string | null;
    isDefaultBranch: boolean;
  }) => Promise<readonly string[] | null>;
  /** Set only when `editing` is non-null (this is the edit path, opened from either a canvas edge click or the Outline-view Connections table) — deletes this edge and closes the dialog. */
  readonly onDelete?: () => Promise<void>;
}

function EdgeFormDialog({
  editing,
  nodes,
  edges,
  initialFromNodeId,
  initialToNodeId,
  onOpenChange,
  onSubmit,
  onDelete,
}: EdgeFormDialogProps) {
  const t = useTranslations("agents.wizard.flows");
  const [fromNodeId, setFromNodeId] = React.useState(
    editing?.fromNodeId ?? initialFromNodeId ?? nodes[0]?.id ?? "",
  );
  const [toNodeId, setToNodeId] = React.useState(
    editing?.toNodeId ?? initialToNodeId ?? nodes[1]?.id ?? "",
  );
  const [label, setLabel] = React.useState(editing?.label ?? "");
  const [ordinal, setOrdinal] = React.useState(
    editing?.ordinal ?? nextOrdinalForSource(edges, fromNodeId),
  );
  const [conditionExpression, setConditionExpression] = React.useState(
    editing?.conditionExpression ?? "",
  );
  const [isDefaultBranch, setIsDefaultBranch] = React.useState(editing?.isDefaultBranch ?? false);
  const [errors, setErrors] = React.useState<readonly string[]>([]);
  const [pending, setPending] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  async function handleDelete(): Promise<void> {
    if (!onDelete) return;
    setDeleting(true);
    await onDelete();
    setDeleting(false);
  }

  // Re-derives the next free ordinal whenever the "From" node changes on a NEW edge (the
  // Select is disabled while editing, so `editing` never changes underneath this effect) —
  // the fix applies identically whether that node came from a manual Select pick or a real
  // drag-to-connect prefill. The ordinal field itself stays a normal, editable `Input` below,
  // so this is a sane default, not an enforced value.
  React.useEffect(() => {
    if (editing) return;
    setOrdinal(nextOrdinalForSource(edges, fromNodeId));
  }, [editing, edges, fromNodeId]);

  async function submit(): Promise<void> {
    setPending(true);
    const result = await onSubmit({
      fromNodeId,
      toNodeId,
      label: label || null,
      ordinal,
      conditionExpression: conditionExpression || null,
      isDefaultBranch,
    });
    setPending(false);
    if (result) setErrors(result);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="md" closeLabel={t("closeLabel")}>
        <DialogHeader>
          <DialogTitle>{editing ? t("editEdgeDialogTitle") : t("addEdgeDialogTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {errors.length > 0 ? (
            <InlineAlert variant="destructive">
              <ul className="list-disc ps-4">
                {errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </InlineAlert>
          ) : null}

          <FormField label={t("fieldFromNode")}>
            {(field) => (
              <Select value={fromNodeId} onValueChange={setFromNodeId} disabled={editing !== null}>
                <SelectTrigger {...field}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {nodes.map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {node.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label={t("fieldToNode")}>
            {(field) => (
              <Select value={toNodeId} onValueChange={setToNodeId} disabled={editing !== null}>
                <SelectTrigger {...field}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {nodes.map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {node.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label={t("fieldEdgeLabel")} labelVariant="optional">
            {(field) => (
              <Input {...field} value={label} onChange={(e) => setLabel(e.target.value)} />
            )}
          </FormField>
          <FormField label={t("fieldOrdinal")}>
            {(field) => (
              <Input
                {...field}
                type="number"
                min={0}
                value={ordinal}
                onChange={(e) => setOrdinal(Number(e.target.value))}
              />
            )}
          </FormField>
          <FormField label={t("fieldEdgeCondition")} labelVariant="optional">
            {(field) => (
              <Input
                {...field}
                dir="ltr"
                variant="mono"
                value={conditionExpression}
                onChange={(e) => setConditionExpression(e.target.value)}
              />
            )}
          </FormField>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-foreground">{t("fieldIsDefaultBranch")}</span>
            <Switch
              checked={isDefaultBranch}
              onCheckedChange={setIsDefaultBranch}
              aria-label={t("fieldIsDefaultBranch")}
            />
          </div>

          <DialogFooter>
            {editing && onDelete ? (
              <Button
                type="button"
                variant="ghost"
                loading={deleting}
                disabled={pending}
                onClick={() => void handleDelete()}
                className="me-auto"
              >
                {t("deleteAction")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending || deleting}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" loading={pending} disabled={deleting}>
              {editing ? t("saveAction") : t("addEdgeDialogSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
