import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { toAppClientError } from './error-envelope';

/**
 * Functional interceptor (LLD §1.2/§9.1) that unwraps every failed response
 * into an {@link AppClientError} so feature code never inspects raw HTTP
 * error bodies or switches on message strings.
 */
export const errorEnvelopeInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        return throwError(() => toAppClientError(error));
      }
      return throwError(() => error);
    }),
  );
