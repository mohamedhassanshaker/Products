/**
 * The shared "not found" error every citizen-session-scoped use case raises
 * for a conversation id that doesn't exist, belongs to another session, or
 * belongs to another tenant. api.md §4.1's "no enumeration" rule and §2.2's
 * table are explicit that these three cases must be indistinguishable to the
 * caller — a `403` here would itself confirm the id is real, so this is
 * always `404`, never `403`.
 */
export class ConversationNotFoundError extends Error {
  readonly code = "conversation.not_found";
  readonly status = 404;

  constructor() {
    super("No conversation matches this id for the current session.");
    this.name = "ConversationNotFoundError";
  }
}

/**
 * `session.subjectId === conversationId` is this module's session-scoping
 * mechanism (see `ports/conversation-repository.ts`'s own doc comment on why
 * — `SessionRecord` has no separate `conversationId` field). Every citizen-
 * session-scoped endpoint calls this immediately after resolving the session
 * and before touching any repository, so a session that has drifted from its
 * own conversation (or a forged path parameter) fails uniformly and cheaply.
 */
export function requireOwnConversation(sessionSubjectId: string, conversationId: string): void {
  if (sessionSubjectId !== conversationId) throw new ConversationNotFoundError();
}
