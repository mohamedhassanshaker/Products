import { NextResponse } from "next/server";
import { getConversationDetailForAdmin } from "@nextbot/conversations";
import { getAgentRun } from "@nextbot/agent-platform";
import { queryAgentRunSpans, ClickHouseUnavailableError } from "@nextbot/db/clickhouse";
import { requireApi } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/conversations/:id/trace` (RBAC: conversations=Read) — screen
 * inventory B.4.2's Trace Viewer data: for every distinct `agent_run.id` a message in
 * this conversation references (`message.agentRunId`, Phase 13's join key), returns
 * the `agent_run` row plus its `agent_run_span` rows from ClickHouse (LLD §3.10),
 * ordered oldest-first per run.
 *
 * Distinguishes "no runs recorded for this conversation" (empty `runs: []` — a
 * legitimate state for any conversation predating this phase's tracing wiring, or one
 * whose turns never had an `agentDefinitionVersionId` resolved) from "ClickHouse is
 * currently unreachable" (`traceStoreUnavailable: true`) — never conflates the two,
 * per this phase's `queryAgentRunSpans` contract.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("conversations", "Read");
  if (guard instanceof Response) return guard;

  const { id } = await params;
  const conversation = await getConversationDetailForAdmin(guard.ctx, id);
  if (!conversation) {
    return NextResponse.json({ type: "about:blank", title: "Conversation not found.", status: 404 }, { status: 404 });
  }

  const runIds = Array.from(new Set(conversation.messages.map((m) => m.agentRunId).filter((v): v is string => v !== null)));
  if (runIds.length === 0) {
    return NextResponse.json({ runs: [], traceStoreUnavailable: false });
  }

  let traceStoreUnavailable = false;
  const runs = [];
  for (const runId of runIds) {
    const run = await getAgentRun(guard.ctx, runId);
    if (!run) continue;
    try {
      const spans = await queryAgentRunSpans(guard.ctx, runId);
      runs.push({ run, spans });
    } catch (err) {
      if (err instanceof ClickHouseUnavailableError) {
        traceStoreUnavailable = true;
        runs.push({ run, spans: [] });
      } else {
        throw err;
      }
    }
  }

  return NextResponse.json({ runs, traceStoreUnavailable });
}
