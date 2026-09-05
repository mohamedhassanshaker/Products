import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getAuditLogService } from '@/server/platform/audit';
import { optionalInt, optionalString } from '@/server/common/http/validate';

/**
 * `GET /api/platform/audit-log` — platform-realm, authenticated. New this dispatch (migration plan
 * Phase 2 sub-slice "2d") — no legacy HTTP precedent (legacy never built an admin-facing audit
 * viewer). Read-only, paginated, optionally filtered by `actorId`/`action`/`targetType`/`targetId`
 * (every filter combined with AND) — the Audit Log console page's own source data (§18.10 of
 * `docs/design/UX_GUIDELINES.md`).
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withPlatformAuth(request, async () => {
    const query = request.nextUrl.searchParams;
    const actorId = optionalString(query.get('actorId') ?? undefined, 'actorId', { min: 1, max: 64 });
    const action = optionalString(query.get('action') ?? undefined, 'action', { min: 1, max: 100 });
    const targetType = optionalString(query.get('targetType') ?? undefined, 'targetType', { min: 1, max: 100 });
    const targetId = optionalString(query.get('targetId') ?? undefined, 'targetId', { min: 1, max: 64 });
    const pageRaw = query.get('page');
    const pageSizeRaw = query.get('pageSize');
    const page = optionalInt(pageRaw ? Number(pageRaw) : undefined, 'page', { min: 1 });
    const pageSize = optionalInt(pageSizeRaw ? Number(pageSizeRaw) : undefined, 'pageSize', { min: 1, max: 100 });

    const audit = await getAuditLogService();
    const result = await audit.list({ actorId, action, targetType, targetId, page, pageSize });
    return NextResponse.json(result);
  });
}
