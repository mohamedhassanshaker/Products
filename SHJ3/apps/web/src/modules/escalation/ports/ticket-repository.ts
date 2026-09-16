/**
 * `EscalationTickets` — the read/assign/lifecycle side. `conversation/ports/
 * escalation-repository.ts` (B-6) owns *creation* only — its own doc comment says so
 * plainly ("created here; read-only everywhere else — B8 owns the queue/assignment
 * side"). This port is that other side: everything this module does to a ticket after
 * it exists.
 */

import type { RuleTargetKind } from "../domain/routing-rule-engine.js";

export interface EscalationTicketSummary {
  readonly id: string;
  readonly conversationId: string;
  readonly topic: string;
  /** `Billing` | `Customs` | `Library` | `General`. */
  readonly topicKey: string;
  /** A `Channels.key` value. */
  readonly channelKey: string;
  /** `Normal` | `High`. */
  readonly priority: string;
  /** `ToolFailure` | `UserRequest` | `LowConfidence`. */
  readonly reason: string;
  readonly reasonDetail: string;
  /** `Queued` | `Assigned` | `Active` | `Resolved` | `Abandoned`. */
  readonly status: string;
  readonly routeTargetTeamId: string | null;
  readonly assignedStaffUserId: string | null;
  readonly queuedAt: Date;
  readonly wasRequeued: boolean;
}

export interface EscalationTicketDetail extends EscalationTicketSummary {
  readonly verificationState: string;
  readonly citizenIdentityId: string | null;
  readonly pendingSlotName: string | null;
  /** The already-masked transcript/slot snapshot captured *at handover time*
   *  (`request-handover.ts`) — kept as a citation of what the ticket opened with, even
   *  though `GetTicketDetail` reads the conversation's *live* turns for display so the
   *  agent sees everything that happened, including after the handover. */
  readonly contextSnapshotJson: string;
  readonly assignedAt: Date | null;
  readonly firstResponseAt: Date | null;
  readonly resolvedAt: Date | null;
}

export interface RouteAssignment {
  readonly routedByRoutingRuleId: string | null;
  readonly routeTargetTeamId: string | null;
  readonly targetKind: RuleTargetKind | null;
}

export interface TicketRepository {
  /** Every ticket still in `Queued`/`Assigned`/`Active`, oldest-queued-first within the
   *  same priority — a live agent's whole worklist. */
  listOpen(): Promise<readonly EscalationTicketSummary[]>;

  findById(ticketId: string): Promise<EscalationTicketDetail | null>;

  /** `Queued` tickets that have never been routed (`routedByRoutingRuleId IS NULL AND
   *  routeTargetTeamId IS NULL`) — `ListEscalationQueue`'s own lazy-routing hook. */
  listUnrouted(): Promise<readonly EscalationTicketSummary[]>;

  /** Persists a routing decision — never touches `status`. */
  assignRouting(ticketId: string, assignment: RouteAssignment): Promise<void>;

  /**
   * Atomic claim: `UPDATE ... WHERE id = ticketId AND status = 'Queued'`. Returns
   * `false` (never throws) when the conditional update touched zero rows — the caller
   * (`ClaimTicket`) is what turns that into `TicketAlreadyClaimedError`, keeping the
   * "what does zero rows mean" decision in the application layer rather than the
   * adapter (this project's own "an empty result is not proof of correctness" habit,
   * applied here to a conditional write instead of a read).
   */
  claim(ticketId: string, staffUserId: string, now: Date): Promise<boolean>;

  /** First agent message on a still-`Assigned` ticket flips it to `Active` and stamps
   *  `firstResponseAt`. A no-op (not an error) once already `Active`. */
  markActive(ticketId: string, now: Date): Promise<void>;

  /** Back to `Queued`, `assignedStaffUserId` cleared (`CK_EscalationTickets_
   *  assignedPaired`). `wasRequeued` is set so the queue can show it happened. */
  release(ticketId: string, now: Date): Promise<void>;

  /** `Resolved`/`Abandoned` — clears `assignedStaffUserId` (the same constraint). */
  resolve(ticketId: string, status: "Resolved" | "Abandoned", now: Date): Promise<void>;

  /** Every ticket currently held (`Assigned`/`Active`) by this staff user — `SetAgentPresence`'s
   *  own offline-drain needs this before it can release each one. */
  listHeldBy(staffUserId: string): Promise<readonly EscalationTicketSummary[]>;
}
