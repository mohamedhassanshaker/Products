import type {
  AuditLogFilter,
  AuditLogPage,
  AuditLogRepository,
} from "../ports/audit-log-repository.js";

/** B14 tab 2's audit log table — cursor-paginated, read-only. */
export class ListAuditLog {
  constructor(private readonly deps: { readonly auditLog: AuditLogRepository }) {}

  async execute(filter: AuditLogFilter): Promise<AuditLogPage> {
    return this.deps.auditLog.list(filter);
  }
}
