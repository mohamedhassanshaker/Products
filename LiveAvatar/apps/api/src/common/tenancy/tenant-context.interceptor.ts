import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { lastValueFrom, Observable, of } from 'rxjs';
import type { Request } from 'express';
import { TenantContext } from './tenant-context';

/**
 * Binds TenantContext ALS for the entire request so Prisma tenantGuard and
 * repositories see the same tenant id (FR-TENANT-5).
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  /**
   * @param context - HTTP context
   * @param next - Handler
   */
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<Request>();
    const tenantId = (req.params['id'] ?? req.params['tenantId'] ?? null) as string | null;
    const result = await TenantContext.run({ tenantId, bypass: false }, () =>
      lastValueFrom(next.handle()),
    );
    return of(result);
  }
}
