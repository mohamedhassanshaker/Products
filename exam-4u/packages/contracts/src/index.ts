/**
 * Public surface of `@examland/contracts`. Both `apps/api` and `apps/web` import exclusively from
 * this barrel (LLD §1) — never reach into `src/dto/*` or `src/error-codes.ts` directly, so the
 * package's public API stays a single reviewable list.
 */
export * from './error-codes';
export * from './dto/error-envelope.dto';
export * from './dto/health.dto';
export * from './dto/ai-service.dto';
export * from './enums/tenant-status.enum';
export * from './enums/provisioning-step.enum';
