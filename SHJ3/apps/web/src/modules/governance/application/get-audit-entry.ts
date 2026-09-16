import type { AuditLogEntryRow, AuditLogRepository } from "../ports/audit-log-repository.js";

export class AuditEntryNotFoundError extends Error {
  readonly code = "governance.audit_entry_not_found";
  constructor() {
    super("This audit log entry does not exist.");
    this.name = "AuditEntryNotFoundError";
  }
}

/** B14 tab 2's entry detail (full before/after diff). */
export class GetAuditEntry {
  constructor(private readonly deps: { readonly auditLog: AuditLogRepository }) {}

  async execute(id: string): Promise<AuditLogEntryRow> {
    const row = await this.deps.auditLog.get(id);
    if (!row) throw new AuditEntryNotFoundError();
    return row;
  }
}
