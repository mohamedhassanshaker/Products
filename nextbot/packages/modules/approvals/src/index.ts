// PUBLIC API for the "approvals" module. The ONLY file other packages may import from
// (LLD §2.2).
//
// QA fix (BE-2, FR-ADM-06): this module was reserved scaffolding with no behavior
// through Phase 0 — it now exposes the two `tool_call` retention-enforcement
// primitives the Phase 17/18 retention-purge sweeper (`apps/worker/src/
// retention-purge.ts`) needs. See `./infrastructure/tool-call-retention.ts` for the
// payload-vs-metadata category split this module boundary implements.
export { redactToolCallPayloadsOlderThan, purgeToolCallMetadataOlderThan } from "./infrastructure/tool-call-retention.js";
export { findToolCallsByConversationIds, deleteToolCallsByConversationIds, type ToolCallRow } from "./infrastructure/tool-call-query.js";
export { getToolHealthSummaries, type ToolHealthSummary } from "./infrastructure/tool-call-health.js";
