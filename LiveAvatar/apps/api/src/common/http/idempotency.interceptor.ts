import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, of, tap } from 'rxjs';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../errors/app-error';
import { hashRequestBody } from './stable-json';
import { TenantContext } from '../tenancy/tenant-context';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Optional Idempotency-Key on mutating admin routes (LLD §8.6).
 * Same key + same body → replay stored response. Same key + different body → 409.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param context - HTTP context
   * @param next - Handler
   * @returns Original or replayed result
   */
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const method = req.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }
    const rawKey = req.header('Idempotency-Key') ?? req.header('idempotency-key');
    if (!rawKey) {
      return next.handle();
    }
    if (!UUID_RE.test(rawKey)) {
      throw AppError.badRequest('IDEMPOTENCY_KEY_REUSED', {
        fields: { 'Idempotency-Key': 'must be a UUID' },
      });
    }

    const actorId = (req as Request & { user?: { id?: string } }).user?.id ?? null;
    const scope = `${method} ${req.route?.path ?? req.path}`;
    const requestHash = hashRequestBody(req.body ?? {});
    const tenantId = TenantContext.get()?.tenantId ?? null;

    const existing = await this.prisma.withBypass(() =>
      this.prisma.idempotencyRecord.findFirst({
        where: { scope, key: rawKey, actorId },
      }),
    );
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw AppError.conflict('IDEMPOTENCY_KEY_REUSED');
      }
      res.status(existing.responseStatus);
      return of(existing.responseBody);
    }

    return next.handle().pipe(
      tap((body) => {
        const status = res.statusCode || 200;
        void this.prisma
          .withBypass(() =>
            this.prisma.idempotencyRecord.create({
              data: {
                key: rawKey,
                scope,
                actorId,
                tenantId,
                requestHash,
                responseStatus: status,
                responseBody: body as object,
              },
            }),
          )
          .catch((err: unknown) => {
            // Fail-safe: a disk/unique race must not fail the original request.
            req.log?.warn?.({ err }, 'idempotency persist failed');
          });
      }),
    );
  }
}
