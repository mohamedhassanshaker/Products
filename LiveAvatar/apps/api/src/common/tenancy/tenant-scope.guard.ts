import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { TenantContext } from './tenant-context';
import type { AdminActor } from '../auth/admin-actor';

/**
 * Copies `:id` / `:tenantId` from the route into TenantContext so Prisma
 * tenantGuard can inject `tenant_id`. Does not itself decide the response
 * status — use cases own that, and every tenant-scoped use case must return
 * `404 TENANT_NOT_FOUND` for both "doesn't exist" and "exists but not yours"
 * (FR-TENANT-5 / HLD §7 layer 3: never `403`, so existence is never leaked).
 */
@Injectable()
export class TenantScopeGuard implements CanActivate {
  /**
   * Always allows; side effect is ALS population.
   * @param context - HTTP context
   */
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: AdminActor }>();
    const tenantId = (req.params['id'] ?? req.params['tenantId'] ?? null) as string | null;
    TenantContext.run({ tenantId, bypass: false }, () => undefined);
    // Nest guards cannot keep ALS across the handler if we return here after run ends.
    // The interceptor below re-enters ALS for the full request lifetime.
    (req as Request & { tenantId?: string | null }).tenantId = tenantId;
    return true;
  }
}
