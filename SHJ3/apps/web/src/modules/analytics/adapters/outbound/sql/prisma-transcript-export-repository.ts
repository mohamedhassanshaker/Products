import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  NewTranscriptExportInput,
  TranscriptExportFormat,
  TranscriptExportRepository,
  TranscriptExportRow,
} from "../../../ports/transcript-export-repository.js";

export class PrismaTranscriptExportRepository implements TranscriptExportRepository {
  async create(input: NewTranscriptExportInput): Promise<TranscriptExportRow> {
    // `TR_TranscriptExports_audit` writes the matching `AuditLogEntries` row in this same
    // INSERT's transaction — this method issues no audit call of its own.
    const row = await getTenantDb("transcript export create").transcriptExport.create({
      data: {
        id: newUlid(input.now),
        requestedByStaffUserId: input.requestedByStaffUserId,
        filterJson: input.filterJson,
        exportedRowCount: input.exportedRowCount,
        format: input.format,
        // CK_TranscriptExports_redactionApplied CHECK (redactionApplied = 1) — a literal,
        // never a parameter, so this call can never produce a row the constraint rejects.
        redactionApplied: true,
        expiresAt: input.expiresAt,
        createdAt: input.now,
      },
    });
    return {
      id: row.id,
      requestedByStaffUserId: row.requestedByStaffUserId,
      filterJson: row.filterJson,
      exportedRowCount: row.exportedRowCount,
      format: row.format as TranscriptExportFormat,
      redactionApplied: row.redactionApplied,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }
}
