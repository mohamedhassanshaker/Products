"use client";

import * as React from "react";

export type NearestNeighborDirection = "up" | "down" | "left" | "right";

export interface PositionedItem {
  id: string;
  x: number;
  y: number;
}

/**
 * Pure geometry, deliberately factored out of the hook below so it is
 * unit-testable with plain coordinate fixtures and no rendering at all
 * (design-system.md §5.5 #44: *"this needs real geometric nearest-neighbour
 * logic based on node positions, not DOM order"*).
 *
 * A candidate counts as "in that direction" when it is on the correct side of
 * `current` **and** that axis is the dominant one — e.g. for `"right"`,
 * `dx > 0` and `|dx| >= |dy|`. Among every candidate that qualifies, the
 * nearest by straight-line distance wins. This is the standard 2D
 * spatial-navigation heuristic (the same shape browsers' own CSS
 * `spatial-navigation` proposal and game-UI focus systems use): simple enough
 * to reason about and test exhaustively, and it never falls back to DOM order.
 */
export function findNearestNeighbor(
  currentId: string,
  items: readonly PositionedItem[],
  direction: NearestNeighborDirection,
): string | undefined {
  const current = items.find((item) => item.id === currentId);
  if (!current) return undefined;

  let best: { id: string; distance: number } | undefined;

  for (const candidate of items) {
    if (candidate.id === currentId) continue;
    const dx = candidate.x - current.x;
    const dy = candidate.y - current.y;
    if (dx === 0 && dy === 0) continue;

    const qualifies =
      direction === "right"
        ? dx > 0 && Math.abs(dx) >= Math.abs(dy)
        : direction === "left"
          ? dx < 0 && Math.abs(dx) >= Math.abs(dy)
          : direction === "down"
            ? dy > 0 && Math.abs(dy) >= Math.abs(dx)
            : dy < 0 && Math.abs(dy) >= Math.abs(dx);
    if (!qualifies) continue;

    const distance = Math.hypot(dx, dy);
    if (!best || distance < best.distance) {
      best = { id: candidate.id, distance };
    }
  }

  return best?.id;
}

/**
 * Maps a keyboard event's arrow key to a search direction. `ArrowUp`/
 * `ArrowDown` are direction-invariant (§11.6: vertical arrow semantics never
 * reverse under RTL); `ArrowLeft`/`ArrowRight` swap so that, per §5.5 #44,
 * *"arrow-key semantics still reverse"* even though **the canvas's own visual
 * layout does not mirror** — the geometric neighbour search below still runs
 * against the same, un-mirrored node coordinates either way, only the
 * key-to-direction mapping flips.
 */
export function resolveArrowKeyDirection(
  key: string,
  dir: "ltr" | "rtl",
): NearestNeighborDirection | undefined {
  switch (key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return dir === "rtl" ? "right" : "left";
    case "ArrowRight":
      return dir === "rtl" ? "left" : "right";
    default:
      return undefined;
  }
}

export interface UseRovingNodeFocusOptions {
  items: readonly PositionedItem[];
  /** Pre-selected node (e.g. from a prior render) that roving focus should land on first — falls back to the first item. */
  initialFocusedId?: string | undefined;
  dir: "ltr" | "rtl";
}

export interface UseRovingNodeFocusResult {
  /** The id currently holding the roving `tabIndex={0}` — every other item gets `-1`. */
  focusedId: string | undefined;
  /** Registers (or, called with `null`, unregisters) the focusable DOM element for one item id, so focus can be moved imperatively after an arrow key changes `focusedId`. */
  registerRef: (id: string) => (el: SVGGElement | HTMLElement | null) => void;
  /** Wire to the canvas's own `onKeyDown`. Handles arrow-key movement only; the caller still owns Enter/Escape/zoom. Returns `true` when it consumed the key. */
  handleArrowKeyDown: (event: React.KeyboardEvent) => boolean;
  setFocusedId: (id: string) => void;
}

/**
 * Roving-tabindex focus management for a set of spatially-positioned nodes
 * (`role="application"` canvases per §10.4: `GraphCanvas`). One tab stop for
 * the whole set from the page's perspective — only `focusedId` is ever a real
 * tab stop — and arrow keys move that single stop by real geometry via
 * `findNearestNeighbor` above, never by DOM order.
 */
export function useRovingNodeFocus({
  items,
  initialFocusedId,
  dir,
}: UseRovingNodeFocusOptions): UseRovingNodeFocusResult {
  const [focusedId, setFocusedIdState] = React.useState<string | undefined>(
    initialFocusedId ?? items[0]?.id,
  );
  const elementsRef = React.useRef(new Map<string, SVGGElement | HTMLElement>());

  // If the initially-selected node changes identity from the outside (e.g. a
  // fresh selection made via the list view) and nothing has focused the
  // canvas yet, follow it — but never fight a focus change the user already
  // made by interacting with the canvas directly. Deliberately keyed on
  // `initialFocusedId` alone (no exhaustive-deps rule is configured in this
  // project — search-field.tsx's identical, already-verified finding — so no
  // suppression comment is needed for the intentionally-excluded internal
  // `focusedId` this effect must not re-run on).
  React.useEffect(() => {
    if (initialFocusedId !== undefined) {
      setFocusedIdState(initialFocusedId);
    }
  }, [initialFocusedId]);

  // One stable ref-callback per item id, cached rather than allocated fresh
  // on every render: `registerRef(id)` is called inline from JSX
  // (`registerRef={registerRef(node.id)}`), and returning a brand-new
  // function each render would make React tear down and re-attach every
  // node's ref on every re-render — functionally harmless but real,
  // avoidable churn on a canvas that can hold many nodes. Stale entries (an
  // id no longer present in `items`) are pruned whenever the item set
  // changes, so this cache cannot grow unbounded across a long-lived session
  // with a churning node set.
  const refCallbacksRef = React.useRef(
    new Map<string, (el: SVGGElement | HTMLElement | null) => void>(),
  );

  React.useEffect(() => {
    const liveIds = new Set(items.map((item) => item.id));
    for (const id of refCallbacksRef.current.keys()) {
      if (!liveIds.has(id)) refCallbacksRef.current.delete(id);
    }
  }, [items]);

  const registerRef = React.useCallback((id: string) => {
    const cached = refCallbacksRef.current.get(id);
    if (cached) return cached;

    const callback = (el: SVGGElement | HTMLElement | null) => {
      if (el) elementsRef.current.set(id, el);
      else elementsRef.current.delete(id);
    };
    refCallbacksRef.current.set(id, callback);
    return callback;
  }, []);

  // A monotonic token per focus *request* (not per id — see below), consumed
  // by the `useLayoutEffect` after it so the imperative `.focus()` call always
  // runs post-commit, once whatever element it targets is guaranteed mounted.
  const focusRequestRef = React.useRef(0);
  const [focusRequest, setFocusRequest] = React.useState<{ id: string; token: number } | undefined>(
    undefined,
  );

  // **Two real bugs, both caught by this hook's own tests, not style
  // preferences.**
  //
  // 1. An earlier version called `elementsRef.current.get(id)?.focus()`
  //    directly and synchronously inside `setFocusedId`, reasoning that every
  //    id this hook is asked to focus already exists in `elementsRef` from
  //    initial mount. False in general: `GraphCanvas`'s list view calls
  //    `setFocusedId` for a node *while the SVG canvas is unmounted* (the
  //    view is still "list" at that exact synchronous instant, one render
  //    away from switching to "canvas"), so the target element does not exist
  //    in `elementsRef` yet — the synchronous call silently found nothing.
  // 2. A version before *that* deferred to a `useLayoutEffect` keyed on
  //    `[focusedId]` itself. That silently did nothing whenever
  //    `setFocusedId` was called with the id *already* current — e.g.
  //    `GraphCanvas`'s Escape handler returning focus to the same node that
  //    opened the detail panel — because `useState`'s setter bails out of
  //    scheduling a re-render at all when the new value is `Object.is`-equal
  //    to the old one, so a `[focusedId]`-keyed effect never re-runs.
  //
  // Fixed by keying the effect on a *request* — a fresh `{ id, token }` object
  // on every call, `token` monotonically increasing — rather than on the
  // requested id's value. A new object is never `Object.is`-equal to the
  // last one even when `id` repeats, so the effect is guaranteed to re-run on
  // every request; and because it is a real (layout) effect rather than a
  // synchronous call, it always runs after the commit that mounts whatever
  // this request's target element needed to mount.
  const setFocusedId = React.useCallback((id: string) => {
    setFocusedIdState(id);
    focusRequestRef.current += 1;
    setFocusRequest({ id, token: focusRequestRef.current });
  }, []);

  React.useLayoutEffect(() => {
    if (!focusRequest) return;
    elementsRef.current.get(focusRequest.id)?.focus();
    // Deliberately not cleared back to `undefined` afterwards: doing so would
    // itself be a second state update with nothing to key a re-run on, and
    // the next real request already gets a strictly-greater `token`, which is
    // all `Object.is` needs to see this as a new value.
  }, [focusRequest]);

  const handleArrowKeyDown = React.useCallback(
    (event: React.KeyboardEvent): boolean => {
      const direction = resolveArrowKeyDirection(event.key, dir);
      if (!direction || focusedId === undefined) return false;

      const next = findNearestNeighbor(focusedId, items, direction);
      if (next === undefined) return false;

      event.preventDefault();
      setFocusedId(next);
      return true;
    },
    [dir, focusedId, items, setFocusedId],
  );

  return { focusedId, registerRef, handleArrowKeyDown, setFocusedId };
}
