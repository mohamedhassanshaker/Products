import { NextResponse, type NextRequest } from 'next/server';
import { requireTenantId, withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getTenantsService } from '@/server/platform/tenants';
import { optionalString } from '@/server/common/http/validate';

/**
 * `GET`/`PATCH /api/tenant/branding` (LLD §7.3a-equivalent, FR-MT-10, migration plan Phase 9 sub-slice
 * "9a") — ported behavior from `legacy/api/src/platform/tenants/api/tenant-branding.controller.ts`.
 * Guarded by the **tenant** realm (`requireTenantUser` + `requirePermission('tenant.settings.manage')`),
 * not a platform-admin check — a Tenant Admin manages their own tenant's branding; a Platform Admin's
 * equivalent route for managing *any* tenant's branding is a separate, later concern (not built this
 * dispatch — out of scope per the dispatch brief).
 *
 * **Structural tenant-tampering prevention**: both methods resolve the acting tenant from
 * `requireTenantId()` (the ALS-resolved id `withTenantContext` establishes from the trusted
 * `x-tenant-id` header `middleware.ts` set) — no route parameter or body field ever carries a tenant
 * id, so a cross-tenant write is not merely rejected, it is inexpressible through this route's own
 * signature.
 */

/** `GET /api/tenant/branding` — requires `tenant.settings.manage`. */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'tenant.settings.manage');
    const branding = await getTenantsService().then((service) => service.getBranding(requireTenantId()));
    return NextResponse.json(branding);
  });
}

/**
 * `PATCH /api/tenant/branding` — requires `tenant.settings.manage`. Both `logoUrl`/`accentColorOverride`
 * are tri-state (absent = leave unchanged, `null` = clear, a string = validate + set) — mirrors
 * legacy's `UpdateBrandingDto`'s identical contract. This route performs only shape/size guarding
 * (non-string/oversized payload rejection via `optionalString`'s own `max` option); the real
 * hex-format/contrast validation happens exclusively inside `TenantsService.updateBranding` via
 * `color-contrast.ts`'s `validateAccent` (LLD §1.2: business-rule validation belongs in the
 * application service, never only at the HTTP boundary) — this route never calls `validateAccent`
 * itself, and the client is never trusted to have validated anything.
 */
export async function PATCH(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'tenant.settings.manage');

    const body: unknown = await request.json().catch(() => ({}));
    const bodyObj = body as { logoUrl?: unknown; accentColorOverride?: unknown };

    // Tri-state: a key genuinely absent from the parsed body must stay `undefined` (leave unchanged);
    // an explicit `null` must stay `null` (clear) rather than being coerced to `undefined` by
    // `optionalString` — `optionalString` itself returns `undefined` for both `undefined` and `null`
    // inputs, so the tri-state distinction is preserved here by checking `in`/`=== null` directly
    // rather than delegating that decision to `optionalString`.
    const logoUrl =
      'logoUrl' in bodyObj
        ? bodyObj.logoUrl === null
          ? null
          : optionalString(bodyObj.logoUrl, 'logoUrl', { min: 0, max: 1024 })
        : undefined;

    // Deliberately generous (max 64, not 7 — the valid `#RRGGBB` length): an over-length or otherwise
    // malformed value must reach `TenantsService.updateBranding`'s real `normalizeHex` check and be
    // rejected with the specific `INVALID_COLOR_FORMAT` code, not a generic validation error from this
    // route alone (mirrors legacy's `UpdateBrandingDto`'s identical comment/rationale).
    const accentColorOverride =
      'accentColorOverride' in bodyObj
        ? bodyObj.accentColorOverride === null
          ? null
          : optionalString(bodyObj.accentColorOverride, 'accentColorOverride', { min: 0, max: 64 })
        : undefined;

    const updated = await getTenantsService().then((service) =>
      service.updateBranding(requireTenantId(), { logoUrl, accentColorOverride }),
    );
    return NextResponse.json(updated);
  });
}
