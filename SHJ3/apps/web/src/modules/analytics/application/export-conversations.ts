import type {
  ConversationExplorerRepository,
  ConversationOutcomeFilter,
} from "../ports/conversation-explorer-repository.js";
import type {
  TranscriptExportFormat,
  TranscriptExportRepository,
  TranscriptExportRow,
} from "../ports/transcript-export-repository.js";
import { CONVERSATION_LIST_LIMIT } from "./list-conversations.js";

const MS_PER_DAY = 86_400_000;
/** How long an export's download link stays valid. Not specified by any requirement
 *  this wave reads from — a named, reasonable default rather than an unstated one. */
export const EXPORT_EXPIRY_DAYS = 7;

export interface ExportConversationsInput {
  readonly filter: ConversationOutcomeFilter;
  readonly format: TranscriptExportFormat;
  readonly requestedByStaffUserId: string;
  readonly now: Date;
}

/**
 * B1 tab 2's **Export** action. Exports exactly the rows the filtered explorer view
 * would show (bounded by `CONVERSATION_LIST_LIMIT`, the same limit `ListConversations`
 * itself is bounded by — there is no second, unbounded "everything matching" query this
 * module offers), and inserts one real `TranscriptExports` row with `redactionApplied:
 * true` always and `exportedRowCount` set to the real count just produced.
 *
 * `TR_TranscriptExports_audit` writes the matching `AuditLogEntries` row in the same
 * transaction as that INSERT (schema's own doc comment) — this use case makes no
 * separate audit call, and must not, or the export would be audited twice.
 */
export class ExportConversations {
  constructor(
    private readonly deps: {
      readonly explorer: ConversationExplorerRepository;
      readonly exports: TranscriptExportRepository;
    },
  ) {}

  async execute(input: ExportConversationsInput): Promise<TranscriptExportRow> {
    const rows = await this.deps.explorer.list(input.filter, CONVERSATION_LIST_LIMIT);
    return this.deps.exports.create({
      requestedByStaffUserId: input.requestedByStaffUserId,
      filterJson: JSON.stringify({ outcome: input.filter }),
      exportedRowCount: rows.length,
      format: input.format,
      expiresAt: new Date(input.now.getTime() + EXPORT_EXPIRY_DAYS * MS_PER_DAY),
      now: input.now,
    });
  }
}
