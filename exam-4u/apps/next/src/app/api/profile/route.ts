import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { getProfileService } from '@/server/profile';
import { parseJsonBody, requireString } from '@/server/common/http/validate';

/** `GET /api/profile` — tenant-realm, authenticated only (no permission gate — every signed-in user
 * may read their own profile) — ported from `legacy/api/src/modules/profile/api/profile.controller.ts`. */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    return NextResponse.json(await getProfileService().getProfile(principal.userId));
  });
}

/** `PATCH /api/profile` — self-service partial update of the FR-IAM-4 editable fields. `email` is
 * deliberately not accepted here — it is the login identifier, immutable via this surface. */
export async function PATCH(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);

    const body = await parseJsonBody(request);
    const firstName = body.firstName === undefined ? undefined : requireString(body.firstName, 'firstName', { min: 1, max: 100 });
    const lastName = body.lastName === undefined ? undefined : requireString(body.lastName, 'lastName', { min: 1, max: 100 });
    const phone = body.phone === undefined ? undefined : requireString(body.phone, 'phone', { min: 0, max: 40 });
    const occupation = body.occupation === undefined ? undefined : requireString(body.occupation, 'occupation', { min: 0, max: 150 });
    const companyName = body.companyName === undefined ? undefined : requireString(body.companyName, 'companyName', { min: 0, max: 200 });
    const country = body.country === undefined ? undefined : requireString(body.country, 'country', { min: 0, max: 100 });
    const educationLevelId =
      typeof body.educationLevelId === 'number' && Number.isInteger(body.educationLevelId) ? body.educationLevelId : undefined;

    const updated = await getProfileService().updateProfile(principal.userId, {
      firstName,
      lastName,
      phone,
      occupation,
      companyName,
      country,
      educationLevelId,
    });
    return NextResponse.json(updated);
  });
}
