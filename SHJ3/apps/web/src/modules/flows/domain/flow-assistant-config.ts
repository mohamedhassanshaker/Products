/**
 * `FlowAssistantConfig`'s documented default — the Flow Designer AI sidebar's model, before
 * this settings screen existed. Used both by `ensureTenantConfig` (repository) and by the
 * AI settings screen's own display of "what a tenant gets until it changes this."
 *
 * Mirrors `_DEFAULT_MODEL`/no-fallback in `apps/ai`'s `propose_flow_edit.py` exactly — a
 * tenant that never opens this screen must see no behavior change.
 */
export const FLOW_ASSISTANT_CONFIG_DEFAULTS = {
  primaryModel: "anthropic/claude-sonnet-5",
  fallbackModel: null as string | null,
} as const;
