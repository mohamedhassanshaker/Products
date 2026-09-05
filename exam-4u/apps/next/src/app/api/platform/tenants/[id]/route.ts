import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getTenantsService } from '@/server/platform/tenants';

/**
 * `GET /api/platform/tenants/:id` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/tenants/api/tenants.controller.ts`'s `detail`. Returns the full
 * `TenantSummary` shape regardless of soft-delete state (see `TenantsService.get`'s own doc comment)
 * — `404 TENANT_NOT_FOUND` only if `id` resolves to no row at all.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async () => {
    const { id } = await params;
    const service = await getTenantsService();
    return NextResponse.json(await service.get(id));
  });
}
