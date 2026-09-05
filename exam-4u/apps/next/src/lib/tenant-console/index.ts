/**
 * `lib/tenant-console`'s public barrel — re-exports every client-side module for convenient import.
 * Not module-boundary-protected (the ESLint rule only guards `src/server/**`) — this is client-only,
 * browser-side code, mirroring `lib/platform-console/index.ts`'s identical, unprotected shape.
 */
export * from './api-error';
export * from './token-storage';
export * from './http-client';
export * from './auth-api';
export * from './taxonomy-api';
export * from './curricula-api';
export * from './exam-types-api';
export * from './auth-context';
