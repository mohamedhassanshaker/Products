import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getTenantsService } from '@/server/platform/tenants';
import { parseJsonBody } from '@/server/common/http/validate';
import { getAuditLogService } from '@/server/platform/audit';
import { getRequestIp } from '@/server/common/http/request-ip.util';

/**
 * `PATCH /api/platform/tenants/:id/registration-settings` — platform-realm, authenticated. Ported
 * behavior from `legacy/api/src/platform/tenants/api/tenants.controller.ts`'s
 * `updateRegistrationSettings` (FR-MT-6: toggles `allowEmailRegistration`/`allowGoogleSignIn`). Both
 * fields optional — absent means "leave unchanged" (matches `UpdateRegistrationSettingsDto`'s own
 * contract), so a non-boolean/absent value is simply treated as "not supplied" rather than a
 * validation error (mirrors this app's existing loose-optional-field convention, e.g. `PATCH
 * /api/users/:id`).
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row
 * (`tenant.registration_settings_updated`) after the update has already committed — a failure to
 * record it never fails this request.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const { id } = await params;
    const body = await parseJsonBody(request);
    const allowEmailRegistration = typeof body.allowEmailRegistration === 'boolean' ? body.allowEmailRegistration : undefined;
    const allowGoogleSignIn = typeof body.allowGoogleSignIn === 'boolean' ? body.allowGoogleSignIn : undefined;

    const service = await getTenantsService();
    const tenant = await service.updateRegistrationSettings(id, { allowEmailRegistration, allowGoogleSignIn });

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: id,
      action: 'tenant.registration_settings_updated',
      targetType: 'Tenant',
      targetId: id,
      summary: { allowEmailRegistration: tenant.allowEmailRegistration, allowGoogleSignIn: tenant.allowGoogleSignIn },
      ip: getRequestIp(request),
    });

    return NextResponse.json(tenant);
  });
}
