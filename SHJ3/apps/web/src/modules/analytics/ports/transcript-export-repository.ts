/** `TranscriptExports` — `ExportConversations`'s own write. `TR_TranscriptExports_audit`
 *  writes the matching `AuditLogEntries` row in the same transaction (schema's own doc
 *  comment), so this port never writes an audit entry itself. */

export const TRANSCRIPT_EXPORT_FORMATS = ["Csv", "Json"] as const;
export type TranscriptExportFormat = (typeof TRANSCRIPT_EXPORT_FORMATS)[number];

export interface NewTranscriptExportInput {
  readonly requestedByStaffUserId: string;
  /** The exact filter that was applied — the real `ConversationOutcomeFilter`, serialised
   *  verbatim, not reconstructed after the fact. */
  readonly filterJson: string;
  readonly exportedRowCount: number;
  readonly format: TranscriptExportFormat;
  readonly expiresAt: Date;
  readonly now: Date;
}

export interface TranscriptExportRow {
  readonly id: string;
  readonly requestedByStaffUserId: string;
  readonly filterJson: string;
  readonly exportedRowCount: number;
  readonly format: TranscriptExportFormat;
  readonly redactionApplied: boolean;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface TranscriptExportRepository {
  /** `redactionApplied` is not a parameter — `CK_TranscriptExports_redactionApplied
   *  CHECK (redactionApplied = 1)` means it is always `true`; the adapter writes it as a
   *  literal, never as a caller-supplied value that could be `false`. */
  create(input: NewTranscriptExportInput): Promise<TranscriptExportRow>;
}
