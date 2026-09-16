import type {
  ConversationExplorerRepository,
  TranscriptTurnRow,
} from "../ports/conversation-explorer-repository.js";

export class ConversationNotFoundError extends Error {
  readonly code = "analytics.conversation_not_found";
  constructor() {
    super("No conversation with this id.");
    this.name = "ConversationNotFoundError";
  }
}

/** B1 tab 2's "View transcript" expand — reads the real, already-masked
 *  `ConversationTurns.contentMasked` (the same field the citizen widget and the
 *  escalation workspace both display), never a second unmasked copy. */
export class GetConversationTranscript {
  constructor(private readonly deps: { readonly explorer: ConversationExplorerRepository }) {}

  async execute(conversationId: string): Promise<readonly TranscriptTurnRow[]> {
    const turns = await this.deps.explorer.getTranscript(conversationId);
    if (turns === null) throw new ConversationNotFoundError();
    return turns;
  }
}
