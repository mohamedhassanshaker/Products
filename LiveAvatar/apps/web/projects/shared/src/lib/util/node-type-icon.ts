/**
 * Reasoning-graph node type -> Material icon ligature (Phase 9, BL-035/039).
 * Lives in `projects/shared` (not the `reasoning` feature) so both the
 * Reasoning tab's node cards and the Session detail node trace can use the
 * *same* icon per node type without one feature importing another's
 * internals — the admin SPA's ESLint feature-isolation zones
 * (`eslint.config.mjs` `webFeatures`) forbid that, and `UX_SCOPE.md`'s
 * "recognition over recall" heuristic explicitly requires icon consistency
 * across every surface that shows a graph.
 */
const NODE_TYPE_ICONS: Record<string, string> = {
  llm: 'psychology',
  tool: 'build',
  retrieve: 'manage_search',
  router: 'call_split',
  speak: 'record_voice_over',
  end: 'stop_circle',
  // Phase 11 (BL-042/043) — distinct from Router's `call_split` (a single
  // decision fanning to one path) since Parallel fans out to *every* branch
  // concurrently and joins them back.
  parallel: 'merge_type',
  loop: 'repeat',
  // Phase 13 (BL-049/050/051) — distinct from Tool's `build` (a Skill is a
  // packaged capability, not a single HTTP call).
  skill: 'auto_awesome',
  // Phase 14 (BL-052/053) — a human decision point, distinct from every
  // automated node type above.
  hitl: 'gavel',
  // Phase 15 (BL-058) — delegates to another tenant's agent; distinct from
  // Skill's packaged-capability icon (a Sub-agent is a whole other agent,
  // not one capability).
  subagent: 'smart_toy',
  // Phase 15 (BL-059) — "transfer to a human," intent only in v1 (no real
  // telephony transfer) — same icon used for the `handoff_requested` alert
  // type in `features/alerts` for recognition consistency across surfaces.
  handoff: 'support_agent',
  // Phase 15 (BL-060) — session-scoped variable read/write, in-memory only.
  state: 'memory',
};

/** Falls back to a generic node icon for an unrecognized/absent type. */
const DEFAULT_NODE_ICON = 'radio_button_unchecked';

/** @param nodeType - Graph node `type` discriminator (e.g. `'llm'`), or undefined if unknown. */
export function nodeTypeIcon(nodeType: string | undefined | null): string {
  if (!nodeType) {
    return DEFAULT_NODE_ICON;
  }
  return NODE_TYPE_ICONS[nodeType] ?? DEFAULT_NODE_ICON;
}

/** Human-readable label for a node type, used alongside the icon (icons alone are never sufficient a11y). */
const NODE_TYPE_LABELS: Record<string, string> = {
  llm: 'LLM',
  tool: 'Tool',
  retrieve: 'Retrieve',
  router: 'Router',
  speak: 'Speak',
  end: 'End',
  parallel: 'Parallel',
  loop: 'Loop',
  skill: 'Skill',
  hitl: 'HITL',
  subagent: 'Sub-agent',
  handoff: 'Handoff',
  state: 'State',
};

/** @param nodeType - Graph node `type` discriminator, or undefined if unknown. */
export function nodeTypeLabel(nodeType: string | undefined | null): string {
  if (!nodeType) {
    return 'Unknown';
  }
  return NODE_TYPE_LABELS[nodeType] ?? nodeType;
}
