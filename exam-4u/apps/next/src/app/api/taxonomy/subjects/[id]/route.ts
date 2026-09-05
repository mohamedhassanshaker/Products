import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getTaxonomyService } from '@/server/taxonomy';
import { requireIntFromQuery } from '@/server/common/http/validate';

/** `DELETE /api/taxonomy/subjects/:id` — requires `taxonomy.delete`. Success is `204`. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'taxonomy.delete');
    const { id } = await params;
    await getTaxonomyService().deleteSubject(requireIntFromQuery(id, 'id'));
    return new NextResponse(null, { status: 204 });
  });
}
