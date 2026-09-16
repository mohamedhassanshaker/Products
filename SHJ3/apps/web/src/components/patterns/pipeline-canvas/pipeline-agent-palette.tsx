"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { Sparkles, UserRound, Workflow } from "lucide-react";
import { PIPELINE_AGENT_DRAG_MIME } from "./pipeline-canvas-surface";

export interface PipelineAgentOption {
  readonly agentId: string;
  readonly name: string;
}

export interface PipelineAgentPaletteProps {
  agents: readonly PipelineAgentOption[];
  onAddAgent: (agentId: string) => void;
  onAddTurnBoundAgent: () => void;
  onAddResponse: () => void;
  isBelowBreakpoint?: boolean;
  heading?: string;
}

/**
 * The node-creation palette — every button carries BOTH `draggable`+`onDragStart`
 * (`dataTransfer.setData` under `PIPELINE_AGENT_DRAG_MIME`) AND `onClick` calling the exact
 * same handler, so drag is never the only way to add a node (`docs/design-system.md`'s
 * "drag-and-drop is additional, never the only affordance" rule). Below the 820px
 * breakpoint `draggable` is omitted entirely — HTML5 DnD does not fire on touch, and
 * click-to-add is the sole, and also the accessible, gesture there.
 */
export function PipelineAgentPalette({
  agents,
  onAddAgent,
  onAddTurnBoundAgent,
  onAddResponse,
  isBelowBreakpoint = false,
  heading = "Add node",
}: PipelineAgentPaletteProps): React.ReactElement {
  function dragProps(payload: string) {
    if (isBelowBreakpoint) return {};
    return {
      draggable: true,
      onDragStart: (event: React.DragEvent<HTMLButtonElement>) => {
        event.dataTransfer.setData(PIPELINE_AGENT_DRAG_MIME, payload);
        event.dataTransfer.effectAllowed = "copy";
      },
    };
  }

  const buttonClassName = cn(
    "flex items-center rounded text-xs font-medium hover:bg-muted",
    "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]",
  );

  return (
    <div
      data-slot="pipeline-canvas-palette"
      className="flex flex-col border border-border bg-card"
      style={{ borderRadius: "var(--radius-md)", padding: "var(--space-2)", gap: "var(--space-1)" }}
    >
      <span className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
        {heading}
      </span>
      <button
        type="button"
        {...dragProps("__turn_bound__")}
        onClick={onAddTurnBoundAgent}
        className={buttonClassName}
        style={{ color: "var(--chart-2)", gap: "var(--space-1)", padding: "var(--space-1)" }}
      >
        <Icon icon={UserRound} size={14} />
        <span>Turn-bound agent</span>
      </button>
      {agents.map((agent) => (
        <button
          key={agent.agentId}
          type="button"
          {...dragProps(agent.agentId)}
          onClick={() => onAddAgent(agent.agentId)}
          className={buttonClassName}
          style={{ color: "var(--chart-1)", gap: "var(--space-1)", padding: "var(--space-1)" }}
        >
          <Icon icon={Sparkles} size={14} />
          <span>{agent.name}</span>
        </button>
      ))}
      <button
        type="button"
        {...dragProps("__response__")}
        onClick={onAddResponse}
        className={buttonClassName}
        style={{ color: "var(--chart-5)", gap: "var(--space-1)", padding: "var(--space-1)" }}
      >
        <Icon icon={Workflow} size={14} />
        <span>Response</span>
      </button>
    </div>
  );
}
