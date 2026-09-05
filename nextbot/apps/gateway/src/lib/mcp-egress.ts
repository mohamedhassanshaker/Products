/**
 * `apps/gateway`'s `mcp-egress` — now a thin re-export.
 *
 * **Target Architecture Blueprint Phase 16 (BL-47b):** the implementation moved to
 * `@nextbot/tool-registry`'s `application/mcp-egress.ts`, unchanged, because a SECOND
 * composition root now needs it: the workflow executor runs in `apps/worker`
 * (ADR-0013 §7) and a `ToolCall` node dispatches through the same `EgressPort` the
 * approval path uses (ADR-0013 §7.2 constraint 2). `eslint.config.mjs`'s boundaries
 * forbid an app importing another app, and forbid a shared package importing a bounded
 * module — so a bounded module is the only legal shared home, and `tool-registry`
 * already owns the catalog, schema versions and permission resolver this needs. See
 * that file's own doc comment for the full reasoning, the three security properties it
 * preserves, and the disclosed observation about ADR-0004's wording.
 *
 * This file is kept (rather than deleted, with call sites repointed) deliberately:
 * every existing gateway import path and every existing gateway test —
 * `mcp-egress.int.test.ts`, `orchestration-approval-service.int.test.ts`, the
 * turn-pipeline suites — continues to exercise the exact same code through the exact
 * same specifier, so the move is provably behaviour-preserving rather than merely
 * believed to be.
 */
export { createMcpEgressPort } from "@nextbot/tool-registry";
