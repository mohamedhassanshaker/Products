/**
 * Minimal RFC 4180-ish CSV serializer for the conversation export (Phase 13, BL-06) —
 * no external library needed for this small a surface. Always quotes a field
 * containing a comma, quote, or newline, doubling embedded quotes per the standard.
 */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.map(csvEscape).join(",");
  const body = rows.map((row) => columns.map((col) => csvEscape(row[col])).join(","));
  return [header, ...body].join("\r\n");
}

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
