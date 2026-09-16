"use client";

import * as React from "react";
import { computeTopologicalOrder, siblingIdsOf, type FlowModel } from "../flow-canvas/flow-canvas-types";

/**
 * Re-targets the old grid canvas's topological roving-tabindex keyboard model
 * (`flow-canvas/use-topological-focus.ts`) at xyflow's own rendered nodes.
 *
 * xyflow gives every node a real, focusable DOM element (`.react-flow__node`,
 * `tabIndex 0` when selectable) but its own keyboard handling repurposes
 * arrow keys to MOVE the focused node a few pixels (`disableKeyboardA11y`
 * only turns that off, it does not add topological navigation back) — not
 * what design-system.md §5.5 #45 specifies ("roving tabindex across nodes in
 * topological order… across sibling branches"). Rather than re-building the
 * old hook's separate ref-registration map, this reads the *real* focused
 * element directly off `document.activeElement` (the same "read the real
 * DOM, do not recompute an assumption" discipline `flow-canvas.tsx`'s own
 * `useConnectorGeometry` doc comment already established for this organism)
 * and matches it back to a node id via the `data-node-id` attribute every
 * `FlowGraphNode` renders — one fewer map to keep in sync with xyflow's own
 * node lifecycle.
 */
export function useTopologicalKeyboardNav(
  containerRef: React.RefObject<HTMLElement | null>,
  model: FlowModel,
  dir: "ltr" | "rtl",
) {
  const order = React.useMemo(() => computeTopologicalOrder(model), [model]);

  const focusNode = React.useCallback(
    (id: string) => {
      const container = containerRef.current;
      if (!container) return;
      const el = container.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
      el?.focus();
    },
    [containerRef],
  );

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent): boolean => {
      const container = containerRef.current;
      const active = document.activeElement;
      if (!container || !(active instanceof HTMLElement) || !container.contains(active)) {
        return false;
      }
      const focusedId = active.dataset.nodeId;
      if (!focusedId) return false;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const index = order.indexOf(focusedId);
        if (index === -1) return false;
        const next = order[event.key === "ArrowDown" ? index + 1 : index - 1];
        if (next === undefined) return false;
        event.preventDefault();
        focusNode(next);
        return true;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const forward = dir === "rtl" ? event.key === "ArrowLeft" : event.key === "ArrowRight";
        const siblings = siblingIdsOf(focusedId, model);
        const index = siblings.indexOf(focusedId);
        if (index === -1) return false;
        const next = siblings[forward ? index + 1 : index - 1];
        if (next === undefined) return false;
        event.preventDefault();
        focusNode(next);
        return true;
      }

      return false;
    },
    [containerRef, dir, focusNode, model, order],
  );

  return { order, focusNode, handleKeyDown };
}
