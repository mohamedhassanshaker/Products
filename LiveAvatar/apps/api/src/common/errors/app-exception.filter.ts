import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { AppError, TenantScopeViolationError } from './app-error';

/**
 * Renders the LLD error envelope for every exception. Unmapped errors become
 * 500 INTERNAL_ERROR with a correlation id — stack stays in the log only.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  /**
   * Writes `{ error: { code, message, details } }` and the matching HTTP status.
   * @param exception - Thrown value
   * @param host - Nest arguments host
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof AppError) {
      res.status(exception.httpStatus).json({
        error: { code: exception.code, message: exception.message, details: exception.details },
      });
      return;
    }

    if (exception instanceof TenantScopeViolationError) {
      const requestId = randomUUID();
      this.logger.error({ err: exception, requestId, tag: 'security.tenant_scope' }, exception.message);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred.',
          details: { request_id: requestId },
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: string }).message ?? exception.message);
      res.status(status).json({
        error: {
          code: status === 401 ? 'AUTH_UNAUTHORIZED' : 'INTERNAL_ERROR',
          message: typeof message === 'string' ? message : 'An unexpected error occurred.',
          details: {},
        },
      });
      return;
    }

    const requestId = randomUUID();
    this.logger.error({ err: exception, requestId }, 'Unhandled exception');
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        details: { request_id: requestId },
      },
    });
  }
}
