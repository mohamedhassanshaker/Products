import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getPackagesService } from '@/server/platform/billing';
import { parseJsonBody } from '@/server/common/http/validate';
import { ValidationFailedError } from '@/server/common/errors/domain-error';
import { getAuditLogService } from '@/server/platform/audit';
import { getRequestIp } from '@/server/common/http/request-ip.util';

/** One row of the feature-association picker's payload — a feature the admin checked "Enabled" for
 * this package, with an optional per-period `limit` (`null`/omitted = unlimited). A catalog feature
 * simply absent from `features[]` ends up disabled (default-deny, FR-PKG-3) — this shape never
 * carries an explicit "disabled" row, matching legacy's `ReplacePackageFeaturesDto`. */
interface FeatureConfigInput {
  featureId: string;
  limit?: number | null;
}

/** Hand-rolled shape validation for the `PUT .../features` body (no `class-validator`-equivalent DTO
 * layer exists in this app) — mirrors legacy's `ReplacePackageFeaturesDto`'s
 * `IsArray`/`ArrayUnique`/`ValidateNested` constraints: `features` must be an array of
 * `{featureId: string, limit?: number|null}` with no duplicate `featureId`. */
function requireFeatureConfigItems(body: Record<string, unknown>): FeatureConfigInput[] {
  const raw = body.features;
  if (!Array.isArray(raw)) {
    throw new ValidationFailedError([{ field: 'features', constraint: 'features must be an array.' }]);
  }
  const seen = new Set<string>();
  const items: FeatureConfigInput[] = raw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ValidationFailedError([{ field: `features[${index}]`, constraint: 'each entry must be an object.' }]);
    }
    const { featureId, limit } = entry as Record<string, unknown>;
    if (typeof featureId !== 'string' || featureId.length === 0) {
      throw new ValidationFailedError([{ field: `features[${index}].featureId`, constraint: 'featureId must be a non-empty string.' }]);
    }
    if (seen.has(featureId)) {
      throw new ValidationFailedError([{ field: 'features', constraint: 'featureId must be unique across the array.' }]);
    }
    seen.add(featureId);
    if (limit !== undefined && limit !== null && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0)) {
      throw new ValidationFailedError([{ field: `features[${index}].limit`, constraint: 'limit must be a non-negative integer or null.' }]);
    }
    return { featureId, limit: limit as number | null | undefined };
  });
  return items;
}

/**
 * `PUT /api/platform/packages/:id/features` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/packages/api/packages.controller.ts`'s `replaceFeatures` (FR-PKG-3): atomic
 * full replace of a package's feature configuration — deletes every existing `package_feature` row for
 * this package, then inserts exactly the given `features[]` (an omitted catalog feature ends up
 * disabled by default-deny, never an explicit `{enabled: false}` row).
 *
 * `404 PACKAGE_NOT_FOUND` if `id` doesn't resolve to any package; `404 FEATURE_NOT_FOUND` if any
 * `featureId` doesn't resolve to any catalog feature (validated before any write — a bad id never
 * leaves a partially-applied configuration).
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row
 * (`package.features_replaced`) after the atomic replace has already committed — a failure to record
 * it never fails this request.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const { id } = await params;
    const body = await parseJsonBody(request);
    const items = requireFeatureConfigItems(body);

    const service = await getPackagesService();
    const detail = await service.replaceFeatures(id, items);

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: null,
      action: 'package.features_replaced',
      targetType: 'Package',
      targetId: id,
      summary: { featureCount: items.length },
      ip: getRequestIp(request),
    });

    return NextResponse.json(detail);
  });
}
