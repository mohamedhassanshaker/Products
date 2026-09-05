import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getTenantsService, type ListTenantsOptions } from '@/server/platform/tenants';
import { getTenantProvisioningService } from '@/server/platform/provisioning';
import { requireString, requireEmail, parseJsonBody } from '@/server/common/http/validate';
import { getRequestIp } from '@/server/common/http/request-ip.util';
import { getAuditLogService } from '@/server/platform/audit';
import type { TenantStatus } from '@examland/contracts';

const TENANT_STATUSES: TenantStatus[] = ['Provisioning', 'Active', 'Suspended', 'Failed'];

/**
 * `GET /api/platform/tenants` — platform-realm, authenticated (`withPlatformAuth`). Ported behavior
 * from `legacy/api/src/platform/tenants/api/tenants.controller.ts`'s `list` (`ListTenantsQueryDto`):
 * optional `status` (one of {@link TENANT_STATUSES}, ignored if not a recognized value rather than
 * rejected — matches this app's existing "loose query parsing, real validation lives in the service"
 * convention, e.g. `GET /api/users`), `includeDeleted` (`"true"`/anything else), `page`/`pageSize`.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withPlatformAuth(request, async () => {
    const query = request.nextUrl.searchParams;
    const statusRaw = query.get('status');
    const pageRaw = query.get('page');
    const pageSizeRaw = query.get('pageSize');

    const options: ListTenantsOptions = {
      status: statusRaw && (TENANT_STATUSES as string[]).includes(statusRaw) ? (statusRaw as TenantStatus) : undefined,
      includeDeleted: query.get('includeDeleted') === 'true',
      page: pageRaw ? Number(pageRaw) : undefined,
      pageSize: pageSizeRaw ? Number(pageSizeRaw) : undefined,
    };

    const service = await getTenantsService();
    const result = await service.list(options);
    return NextResponse.json(result);
  });
}

/**
 * `POST /api/platform/tenants` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/tenants/api/tenants.controller.ts`'s `create`: delegates to the full
 * {@link import('@/server/platform/provisioning').TenantProvisioningService.provisionNewTenant}
 * workflow (not bare `TenantsService.create`) — this is what makes tenant creation via this endpoint
 * actually provision the schema/RBAC/admin user rather than merely inserting a `Provisioning`-status
 * row the client would then have no way to finish (FR-MT-4). This call is genuinely synchronous and
 * can take several seconds (the full 6-step workflow runs inline) — the client-side UI must reflect
 * that (see `docs/design/UX_GUIDELINES.md` §3.3's "loading experience during the synchronous
 * provisioning call").
 *
 * Success is always `201`, even if the resulting tenant lands in `Failed` status (a mid-workflow step
 * failure) — a row *was* created either way; the client distinguishes "hard rejection" (400/409, no
 * row created) from "created but Failed" (201 body with `status: 'Failed'`) by response shape, not
 * status code, matching the UX doc's explicit guidance not to conflate the two.
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row (`tenant.create`) after the
 * provisioning workflow itself has already succeeded — a failure to record the audit row never fails
 * this request (`AuditLogService.record` is fail-open by design).
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const body = await parseJsonBody(request);
    // `min: 0` (not `requireString`'s own `min: 1` default) is deliberate: an empty/whitespace-only
    // `name` or `subdomainSlug` must still reach `TenantProvisioningService`/`TenantsService.create`
    // so *their* specific business-rule errors (`TENANT_NAME_REQUIRED`/`INVALID_SUBDOMAIN`) fire,
    // rather than this route's own generic `VALIDATION_FAILED` short-circuiting first. Found by this
    // dispatch's own real-route integration test (`phase2-platform-tenants-routes.integration.test.ts`)
    // asserting the exact `ErrorCode` the UX doc's copy table (§3.3/§18) requires — a real behavior
    // bug a build/lint/typecheck pass alone would never have caught. Only a genuinely non-string or
    // over-length value is rejected here; "required" is the service layer's call, not the HTTP layer's.
    const name = requireString(body.name, 'name', { min: 0, max: 200 });
    const subdomainSlug = requireString(body.subdomainSlug, 'subdomainSlug', { min: 0, max: 63 });
    const adminEmail = requireEmail(body.adminEmail, 'adminEmail');

    const provisioning = await getTenantProvisioningService();
    const tenant = await provisioning.provisionNewTenant({ name, subdomainSlug, adminEmail });

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: tenant.id,
      action: 'tenant.create',
      targetType: 'Tenant',
      targetId: tenant.id,
      summary: { name, subdomainSlug, adminEmail },
      ip: getRequestIp(request),
    });

    return NextResponse.json(tenant, { status: 201 });
  });
}
