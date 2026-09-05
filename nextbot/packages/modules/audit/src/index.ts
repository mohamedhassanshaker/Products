// PUBLIC API for the "audit" module. The ONLY file other packages may import from
// (LLD §2.2). Phase 17 (BL-10): append-only audit log, outbox consumer, viewer
// query/export.

export { recordAuditEntry, type RecordAuditInput } from "./application/record-audit.js";
export {
  syncAuditFromEventsForTenant,
  syncAuditFromEventsAcrossAllTenants,
  type AuditSyncResult,
} from "./application/sync-audit-from-events.js";
export { queryAuditLog, findAuditEntriesForTargets, type AuditLogFilters, type AuditLogEntryRow } from "./application/query-audit.js";
export { auditLogToCsv, auditLogToJson } from "./domain/export-format.js";
