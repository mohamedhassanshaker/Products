import type {
  ConversationExplorerRepository,
  ConversationListRow,
  ConversationOutcomeFilter,
} from "../ports/conversation-explorer-repository.js";

/** B1 tab 2's table cap — a real, named bound rather than an unbounded scan; also what
 *  `ExportConversations` exports (it exports exactly the filtered view the screen shows,
 *  not a second, separate "everything matching" query this port does not offer). */
export const CONVERSATION_LIST_LIMIT = 100;

export class ListConversations {
  constructor(private readonly deps: { readonly explorer: ConversationExplorerRepository }) {}

  async execute(filter: ConversationOutcomeFilter): Promise<readonly ConversationListRow[]> {
    return this.deps.explorer.list(filter, CONVERSATION_LIST_LIMIT);
  }
}
