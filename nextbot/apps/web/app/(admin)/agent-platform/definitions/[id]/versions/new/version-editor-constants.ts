/**
 * Shared constants between `VersionEditor.tsx` (Text mode, unchanged from before this
 * phase) and `DesignModeForm.tsx` (new — Phase 9, client-feedback-batch item 7). Hoisted
 * out of `VersionEditor.tsx` so both modules can import the same list without creating
 * an import cycle (`VersionEditor` renders `DesignModeForm`, so `DesignModeForm` can't
 * import back from `VersionEditor.tsx` itself).
 */

/** Graph runtimes selectable for a version. LangGraph/PydanticAI are listed for
 * reference but aren't installed in this deployment, so a version pinned to either
 * can be drafted but can never be promoted to Production (enforced server-side by
 * `promotion-policy.ts`, not by this list). */
export const GRAPH_TYPES = [
  { value: "ADK", label: "ADK" },
  { value: "CustomFSM", label: "CustomFSM" },
  { value: "LangGraph", label: "LangGraph (not installed — can't reach Production)" },
  { value: "PydanticAI", label: "PydanticAI (not installed — can't reach Production)" },
] as const;

/** Model Gateway route keys a version's agent can call at runtime. Static list (not
 * fetched from the Model Gateway API) — matches this screen's pre-existing convention
 * for the top-of-page "Model Route Key" selector; route definitions themselves are
 * configured on the Model Gateway screen. */
export const ROUTE_KEYS = ["chat.primary", "chat.fast", "reasoning.planner", "classify.guardrail", "summarize.escalation", "embed.knowledge"];
