import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { getFileSigningService } from '@/server/files';
import { parseJsonBody, requireString } from '@/server/common/http/validate';

/** `POST /api/files/sign` — tenant-realm, authenticated only (no permission gate — matches legacy's
 * identical `@UseGuards(JwtAuthGuard)`-only surface; authorization is the storage-key-ownership
 * check inside `FileSigningService.sign` itself). Mints a time-limited, tamper-evident download URL
 * for a `storageKey` the caller's own tenant owns. */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    const body = await parseJsonBody(request);
    const storageKey = requireString(body.storageKey, 'storageKey', { min: 1, max: 1024 });

    const signing = getFileSigningService();
    return NextResponse.json(signing.sign(storageKey, principal.tenantId));
  });
}
