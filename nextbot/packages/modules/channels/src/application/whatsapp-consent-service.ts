import { E164_PATTERN } from "@nextbot/contracts";
import type { BulkImportConsentRequest, ConsentImportResult, ConsentRecordDto, ConsentStateValue, RecordConsentRequest } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import { insertConsentImportLog, listConsentRecords, upsertConsentRecord, type ConsentRecordRow } from "../infrastructure/whatsapp-repository.js";

const E164_REGEX = new RegExp(E164_PATTERN);

/** FR-SEC-04-style PII masking: keeps the country code + last 4 digits visible,
 * masks the rest (e.g. `+15551234567` -> `+1•••••1234`) — this system's existing
 * masked-phone convention, applied locally since `channels` cannot import the `pii`
 * module (LLD §2.3 allow-list has no such edge). */
export function maskPhoneNumber(e164: string): string {
  if (e164.length <= 5) return e164;
  const country = e164.slice(0, 2); // "+" + first digit
  const last4 = e164.slice(-4);
  const maskedLength = e164.length - country.length - 4;
  return `${country}${"•".repeat(Math.max(maskedLength, 0))}${last4}`;
}

export async function listConsentRecordDtos(ctx: TenantContext, channelId: string): Promise<ConsentRecordDto[]> {
  const rows = await listConsentRecords(ctx, channelId);
  return rows.map(toDto);
}

export async function recordConsent(ctx: TenantContext, channelId: string, input: RecordConsentRequest): Promise<ConsentRecordDto> {
  await upsertConsentRecord(ctx, { channelId, customerIdentifier: input.customerIdentifier, state: input.state, source: input.source });
  const rows = await listConsentRecords(ctx, channelId);
  const row = rows.find((r) => r.customerIdentifier === input.customerIdentifier);
  return toDto(row as ConsentRecordRow);
}

/**
 * FR-META's "bulk import/export log", with the FR-KB-01 per-item-failure pattern
 * applied verbatim: one row's validation failure (bad phone format, missing state)
 * never blocks the rest of the file — every valid row is imported, every invalid
 * row is reported individually with its specific reason, and the whole outcome is
 * recorded as an auditable `consent_import_log` row.
 */
export async function bulkImportConsent(ctx: TenantContext, channelId: string, request: BulkImportConsentRequest, importedByUserId: string | null): Promise<ConsentImportResult> {
  const errors: { row: number; reason: string }[] = [];
  let succeeded = 0;

  for (let i = 0; i < request.rows.length; i++) {
    const row = request.rows[i]!;
    if (!E164_REGEX.test(row.customerIdentifier)) {
      errors.push({ row: i, reason: "Invalid phone format." });
      continue;
    }
    if (row.state !== "OptedIn" && row.state !== "OptedOut") {
      errors.push({ row: i, reason: "Missing or invalid consent state." });
      continue;
    }
    await upsertConsentRecord(ctx, {
      channelId,
      customerIdentifier: row.customerIdentifier,
      state: row.state as ConsentStateValue,
      source: row.source ?? "BulkImport",
    });
    succeeded += 1;
  }

  const logId = await insertConsentImportLog(ctx, {
    channelId,
    filename: request.filename ?? null,
    totalRows: request.rows.length,
    succeededRows: succeeded,
    failedRows: errors.length,
    errors,
    importedByUserId,
  });

  return { id: logId, totalRows: request.rows.length, succeededRows: succeeded, failedRows: errors.length, errors };
}

/** Dry-run: validates every row without writing anything, so the admin can review
 * a per-row outcome before committing (§7.2.5's explicit two-step UX requirement). */
export function dryRunBulkImportConsent(request: BulkImportConsentRequest): ConsentImportResult {
  const errors: { row: number; reason: string }[] = [];
  let succeeded = 0;
  for (let i = 0; i < request.rows.length; i++) {
    const row = request.rows[i]!;
    if (!E164_REGEX.test(row.customerIdentifier)) {
      errors.push({ row: i, reason: "Invalid phone format." });
      continue;
    }
    if (row.state !== "OptedIn" && row.state !== "OptedOut") {
      errors.push({ row: i, reason: "Missing or invalid consent state." });
      continue;
    }
    succeeded += 1;
  }
  return { id: "dry-run", totalRows: request.rows.length, succeededRows: succeeded, failedRows: errors.length, errors };
}

export function exportConsentRecordsCsv(rows: ConsentRecordRow[]): string {
  const header = "customer_identifier_masked,state,source,recorded_at";
  const lines = rows.map((r) => `${maskPhoneNumber(r.customerIdentifier)},${r.state},${r.source},${r.recordedAt.toISOString()}`);
  return [header, ...lines].join("\n");
}

function toDto(row: ConsentRecordRow): ConsentRecordDto {
  return {
    id: row.id,
    customerIdentifierMasked: maskPhoneNumber(row.customerIdentifier),
    state: row.state,
    source: row.source,
    recordedAt: row.recordedAt.toISOString(),
  };
}
