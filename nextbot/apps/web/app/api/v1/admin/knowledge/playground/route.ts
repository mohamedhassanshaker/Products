import { NextResponse, type NextRequest } from "next/server";
import { handleRunRetrievalPlayground } from "@nextbot/knowledge";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { checkRateLimit } from "@/src/lib/rate-limit";
import { getSession } from "@/src/lib/session";

/** Every call makes at least one real Model Gateway embedding call (and, for
 *  GraphGlobal, a completion call too) — a real per-call dollar cost an authenticated
 *  admin could otherwise trigger repeatedly with no ceiling. Mirrors
 *  `conversations/export`'s own per-user fixed-window limiter exactly (same
 *  fail-open-on-Redis-outage rationale — see `rate-limit.ts`'s doc comment). */
const PLAYGROUND_LIMIT = 20;
const PLAYGROUND_WINDOW_SECONDS = 60;

/**
 * `POST /api/v1/admin/knowledge/playground` (RBAC: knowledge=Read — LLD §14.4.5).
 * Target Architecture Blueprint Phase 9 (BL-40, FR-KB-05). Runs one or more of the
 * four retrieval strategies (Vector/GraphLocal/GraphGlobal/Hybrid — all four when
 * `strategies` is omitted, matching LLD's own "runs ALL FOUR strategies" wording for
 * this endpoint) against a collection's current Ready generation. Read-only over
 * already-ingested data — the underlying strategies DO make real Model Gateway calls
 * (embedding + occasionally a completion for GraphGlobal's reduce step), which is why
 * this is gated the same as every other knowledge read: an admin/curator action, not
 * a customer-facing surface.
 */
export async function POST(request: NextRequest) {
  const guard = await requireApi("knowledge", "Read");
  if (guard instanceof Response) return guard;

  const session = await getSession();
  const rateLimit = await checkRateLimit(`knowledge-playground:${session?.userId ?? guard.ctx.tenantId}`, PLAYGROUND_LIMIT, PLAYGROUND_WINDOW_SECONDS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { type: "about:blank", title: "Too many retrieval playground requests — please wait a minute and try again.", status: 429 },
      { status: 429, headers: { "Retry-After": String(PLAYGROUND_WINDOW_SECONDS) } },
    );
  }

  try {
    const body = await request.json();
    const { collectionId, ...rest } = body ?? {};
    if (typeof collectionId !== "string" || !collectionId) {
      return NextResponse.json({ type: "about:blank", title: "collectionId is required.", status: 422 }, { status: 422 });
    }
    const result = await handleRunRetrievalPlayground(guard.ctx, collectionId, rest);
    return NextResponse.json(result);
  } catch (err) {
    return problemResponse(err);
  }
}
