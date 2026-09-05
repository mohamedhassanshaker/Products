import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../errors/app-error';

/**
 * Reads the required If-Match header (ISO-8601 `updated_at`).
 * @returns Header value
 * @throws AppError 409 TENANT_CONFLICT when missing (caller asked for a lock)
 */
export const IfMatch = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const value = req.header('If-Match') ?? req.header('if-match');
  if (!value) {
    throw AppError.conflict('TENANT_CONFLICT');
  }
  return value;
});
