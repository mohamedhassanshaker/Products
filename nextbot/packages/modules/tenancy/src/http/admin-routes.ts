import type { UpdateBrandingRequest } from "@nextbot/contracts";
import { getTenantBranding } from "../application/tenant-branding.js";
import { updateBranding } from "../application/update-branding.js";

/**
 * `http/` layer (LLD §2.2): plain functions the composition root
 * (`apps/web/app/api/v1/admin/branding/route.ts`) calls into — RBAC (`security_settings`
 * module) is enforced there, not here, same convention as every other module's
 * `http/admin-routes.ts` (`tenancy` cannot depend on `iam`, LLD §2.3's allow-list).
 */

export async function handleGetBranding(tenantId: string) {
  return getTenantBranding(tenantId);
}

export async function handleUpdateBranding(tenantId: string, input: UpdateBrandingRequest) {
  await updateBranding(tenantId, input);
  return getTenantBranding(tenantId);
}
