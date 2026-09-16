import type { CitizenIdentityRepository } from "../../identity/ports/citizen-identity-repository.js";
import type {
  ConversationRepository,
  ConversationTurnRow,
} from "../../conversation/ports/conversation-repository.js";
import { ESCALATION_REASON_LABELS, isEscalationReason } from "../domain/escalation-reason.js";
import type { CannedReplyRepository, CannedReplyRow } from "../ports/canned-reply-repository.js";
import type { EscalationTicketDetail, TicketRepository } from "../ports/ticket-repository.js";

export class TicketNotFoundError extends Error {
  readonly code = "handover.ticket_not_found";
  constructor() {
    super("No escalation ticket with this id.");
    this.name = "TicketNotFoundError";
  }
}

export interface TicketDetailResult {
  readonly ticket: EscalationTicketDetail;
  /** The full, *live* transcript (never the frozen `contextSnapshotJson` alone) — the
   *  hard requirement this use case exists to prove: "escalation transfers transcript,
   *  identity state and pending slot — never a cold start." Reading the conversation's
   *  real current turns (rather than only replaying the snapshot captured at the moment
   *  of handover) means an agent also sees anything the citizen said *after* requesting
   *  a human, which the frozen snapshot alone could not. */
  readonly transcript: readonly ConversationTurnRow[];
  readonly reasonLabel: string;
  readonly identity: {
    readonly assuranceLevel: string;
    readonly displayNameMasked: string | null;
    readonly verifiedByProviderKey: string | null;
  } | null;
  readonly cannedReplies: readonly CannedReplyRow[];
}

const TRANSCRIPT_LIMIT = 500;

export class GetTicketDetail {
  constructor(
    private readonly deps: {
      readonly tickets: TicketRepository;
      readonly conversations: ConversationRepository;
      readonly citizenIdentities: CitizenIdentityRepository;
      readonly cannedReplies: CannedReplyRepository;
    },
  ) {}

  async execute(ticketId: string, localeCode: string): Promise<TicketDetailResult> {
    const ticket = await this.deps.tickets.findById(ticketId);
    if (!ticket) throw new TicketNotFoundError();

    const [transcript, identityRow, cannedReplies] = await Promise.all([
      this.deps.conversations.listTurnsAfter(ticket.conversationId, 0, TRANSCRIPT_LIMIT),
      ticket.citizenIdentityId
        ? this.deps.citizenIdentities.findById(ticket.citizenIdentityId)
        : Promise.resolve(null),
      this.deps.cannedReplies.listForTopic(ticket.topicKey, localeCode),
    ]);

    return {
      ticket,
      transcript: transcript.slice(0, TRANSCRIPT_LIMIT),
      reasonLabel: isEscalationReason(ticket.reason)
        ? ESCALATION_REASON_LABELS[ticket.reason]
        : ticket.reasonDetail,
      identity: identityRow
        ? {
            assuranceLevel: identityRow.assuranceLevel,
            displayNameMasked: identityRow.displayNameMasked,
            verifiedByProviderKey: identityRow.verifiedByProviderKey,
          }
        : null,
      cannedReplies,
    };
  }
}
