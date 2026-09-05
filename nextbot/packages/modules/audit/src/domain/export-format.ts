import type { AuditLogEntryRow } from "../application/query-audit.js";

/** Pure serialization for B.8.2's CSV/JSON export — no I/O, so the escaping rules
 * are unit-testable without a database (LLD §2.2). */

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function auditLogToCsv(rows: AuditLogEntryRow[]): string {
  const header = ["occurredAt", "actorLabel", "actionType", "targetType", "targetId", "outcome", "details"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.occurredAt.toISOString(),
        r.actorLabel,
        r.actionType,
        r.targetType ?? "",
        r.targetId ?? "",
        r.outcome,
        JSON.stringify(r.details),
      ]
        .map((v) => csvEscape(String(v)))
        .join(","),
    );
  }
  return lines.join("\n");
}

export function auditLogToJson(rows: AuditLogEntryRow[]): string {
  return JSON.stringify(rows, null, 2);
}
