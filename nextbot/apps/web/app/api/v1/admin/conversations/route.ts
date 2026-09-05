import { NextResponse, type NextRequest } from "next/server";
import { listConversationsForAdmin } from "@nextbot/conversations";
import { requireApi } from "@/src/lib/api-guard";
import { parseConversationFilters } from "@/src/lib/conversation-filters";

/** `GET /api/v1/admin/conversations` (RBAC: conversations=Read) — screen inventory
 * B.4.1's filterable/paginated conversation list. Tenant-scoped via `requireApi`'s
 * resolved `TenantContext`; every filter param is parsed/validated (never trusted
 * verbatim) by `parseConversationFilters`. */
export async function GET(request: NextRequest) {
  const guard = await requireApi("conversations", "Read");
  if (guard instanceof Response) return guard;

  const filters = parseConversationFilters(request.nextUrl.searchParams);
  const result = await listConversationsForAdmin(guard.ctx, filters);
  return NextResponse.json(result);
}
