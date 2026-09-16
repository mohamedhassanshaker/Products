"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/patterns/dialog/dialog.js";
import {
  PipelineNodeInspector,
  type PipelineNodeFieldSpec,
  type PipelineNodeFormValue,
} from "@/components/patterns/pipeline-canvas/pipeline-node-inspector.js";
import type { PipelineCanvasNode } from "@/components/patterns/pipeline-canvas/pipeline-canvas-types.js";
import type { PipelineNodeRow } from "../../../../../../modules/orchestration/ports/pipeline-repository.js";

export interface PipelineAgentOption {
  readonly agentId: string;
  readonly name: string;
}

export interface PipelineNodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: PipelineNodeRow | undefined;
  agents: readonly PipelineAgentOption[];
  onSave: (value: PipelineNodeFormValue) => void;
  onDelete: () => void;
  saving?: boolean;
}

function fieldsFor(
  node: PipelineNodeRow,
  agents: readonly PipelineAgentOption[],
): readonly PipelineNodeFieldSpec[] {
  const common: PipelineNodeFieldSpec[] = [{ key: "title", kind: "text", label: "Title", required: true }];
  if (node.kind === "Start" || node.kind === "Response") return common;

  return [
    ...common,
    { key: "usesTurnBoundAgent", kind: "boolean", label: "Use the turn's own bound agent" },
    {
      key: "agentId",
      kind: "select",
      label: "Agent",
      options: [
        { value: "", label: "— none —" },
        ...agents.map((agent) => ({ value: agent.agentId, label: agent.name })),
      ],
    },
    {
      key: "inputContextMode",
      kind: "select",
      label: "Input context",
      options: [
        { value: "UserTurnOnly", label: "User turn only" },
        { value: "UpstreamRepliesFull", label: "Full upstream replies" },
        { value: "UpstreamRepliesSummary", label: "Upstream replies, summarized" },
      ],
    },
    { key: "isOwningEntity", kind: "boolean", label: "Owning entity (preferred on conflict)" },
    {
      key: "onErrorPolicy",
      kind: "select",
      label: "On error",
      options: [
        { value: "FailTurn", label: "Fail the turn" },
        { value: "SkipNode", label: "Skip this node" },
        { value: "RouteToFallbackAgent", label: "Route to the fallback agent" },
      ],
    },
  ];
}

function valueOf(node: PipelineNodeRow): PipelineNodeFormValue {
  return {
    title: node.title,
    usesTurnBoundAgent: node.usesTurnBoundAgent,
    agentId: node.agentId ?? "",
    inputContextMode: node.inputContextMode,
    isOwningEntity: node.isOwningEntity,
    onErrorPolicy: node.onErrorPolicy,
  };
}

function toCanvasNode(node: PipelineNodeRow): PipelineCanvasNode {
  const kind = node.kind === "Start" ? "start" : node.kind === "Response" ? "response" : node.kind === "Supervisor" ? "supervisor" : "agent";
  return { id: node.id, kind, title: node.title, agentName: null };
}

/** Opens `PipelineNodeInspector` (the shared, descriptor-driven canvas component) in a
 *  dialog rather than the canvas's own side panel — this route's own choice, since the
 *  editor keeps the canvas full-width and surfaces node config as an overlay instead. */
export function PipelineNodeDialog({
  open,
  onOpenChange,
  node,
  agents,
  onSave,
  onDelete,
  saving = false,
}: PipelineNodeDialogProps): React.ReactElement | null {
  const t = useTranslations("orchestrator.pipeline.nodeDialog");
  const [draft, setDraft] = React.useState<PipelineNodeFormValue>({});
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    if (node) {
      setDraft(valueOf(node));
      setDirty(false);
    }
  }, [node]);

  if (!node) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("heading")}</DialogTitle>
        </DialogHeader>
        <PipelineNodeInspector
          node={toCanvasNode(node)}
          fields={fieldsFor(node, agents)}
          value={draft}
          onChange={(value) => {
            setDraft(value);
            setDirty(true);
          }}
          onSave={() => onSave(draft)}
          onClose={() => onOpenChange(false)}
          onDelete={node.kind !== "Start" ? onDelete : undefined}
          dirty={dirty}
          saving={saving}
          saveLabel={t("saveAction")}
          deleteLabel={t("deleteAction")}
          closeLabel={t("closeAction")}
        />
      </DialogContent>
    </Dialog>
  );
}
