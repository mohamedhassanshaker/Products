import type { TenantContext } from "@nextbot/db";
import type { DelegationTreeResponse } from "@nextbot/contracts";
import { listDelegationEventsForRun } from "../infrastructure/delegation-event-repository.js";
import { buildDelegationTree } from "../domain/tree-builder.js";

/**
 * LLD §14.7.5 — `GET /api/v1/admin/agent-runs/{runId}/delegation-tree`. Returns an
 * empty `roots: []` for a run with no delegation events, which today is EVERY run
 * — there is no live delegation executor yet (Phase 14/BL-46). This is the real,
 * working read path; it is simply never populated by anything yet.
 */
export async function getDelegationTree(ctx: TenantContext, agentRunId: string): Promise<DelegationTreeResponse> {
  const events = await listDelegationEventsForRun(ctx, agentRunId);
  return { agentRunId, roots: buildDelegationTree(events) };
}
