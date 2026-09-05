import { getPlatformDataSource } from '@/server/infrastructure/database';
import { logger } from '@/server/logging';
import { AuditLogRepository } from './infrastructure/audit-log.repository';
import { AuditLogService } from './application/audit-log.service';

export { AuditLogRepository, AuditLogService };
export type { AuditLogEntry, AuditLogListOptions, AuditLogListResult, AuditLogRow } from './domain/audit-log.types';

/**
 * `server/platform/audit`'s public barrel (migration plan Phase 2 sub-slice "2d") — the sole write
 * path for `platform.audit_log` (HLD §5.3). Nothing outside this module may import
 * `./domain/**`/`./infrastructure/**`/`./application/**` directly (enforced by
 * `apps/next/.eslintrc.cjs`'s `platform/audit` module-boundary rule).
 *
 * Deliberately minimal (one repository plus its fail-open application-layer facade), matching
 * `platform/ai-models`'s own "Tier B, one bounded context, small surface" precedent. Every
 * already-shipped platform-admin mutating Route Handler across sub-slices 2a/2b/2c calls
 * {@link getAuditLogService} and writes exactly one row after its own primary action succeeds — see
 * this dispatch's own plan-doc section for the full retrofit list.
 */
declare global {
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandAuditLogService: Promise<AuditLogService> | undefined;
}

/** Composition root for {@link AuditLogService} — cached on `globalThis` for the same Next.js
 * dev-hot-reload reason every other async singleton in this app is. */
export async function getAuditLogService(): Promise<AuditLogService> {
  if (!globalThis.__examlandAuditLogService) {
    globalThis.__examlandAuditLogService = getPlatformDataSource().then(
      (ds) => new AuditLogService(new AuditLogRepository(ds), logger),
    );
  }
  return globalThis.__examlandAuditLogService;
}
