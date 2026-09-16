/** In-memory fakes for every `escalation` port — same convention as `identity/testing/
 *  fakes.ts`: constructor-free, `seed()` to prime state, deterministic fake ids, every
 *  real invariant this module's real Prisma adapters enforce (capacity, the assigned-
 *  paired rule, the order-conflict check) reachable without a database. */

import type {
  AgentPresenceRepository,
  AgentPresenceRow,
} from "../ports/agent-presence-repository.js";
import { DEFAULT_MAX_CONCURRENT_TICKETS } from "../ports/agent-presence-repository.js";
import type { CannedReplyRepository, CannedReplyRow } from "../ports/canned-reply-repository.js";
import type {
  HandoverRoutingConfigRepository,
  HandoverRoutingConfigRow,
} from "../ports/handover-routing-config-repository.js";
import {
  RoutingRuleOrderConflictError,
  type NewRoutingRuleInput,
  type RoutingRuleRepository,
  type RoutingRuleRow,
  type UpdateRoutingRuleInput,
} from "../ports/routing-rule-repository.js";
import type {
  RecordRoutingRuleTestInput,
  RoutingRuleTestRepository,
} from "../ports/routing-rule-test-repository.js";
import type { TeamOption, TeamRepository } from "../ports/team-repository.js";
import type {
  EscalationTicketDetail,
  EscalationTicketSummary,
  RouteAssignment,
  TicketRepository,
} from "../ports/ticket-repository.js";
import type { PresenceStatus } from "../domain/presence.js";
import type {
  ConversationRepository,
  ConversationRow,
  ConversationSlotRow,
  ConversationTurnRow,
  NewConversationInput,
} from "../../conversation/ports/conversation-repository.js";

let idCounter = 0;
function fakeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_fake_${idCounter}`;
}

export class FakeTicketRepository implements TicketRepository {
  private readonly rows = new Map<string, EscalationTicketDetail>();

  seed(row: EscalationTicketDetail): void {
    this.rows.set(row.id, row);
  }

  async listOpen(): Promise<readonly EscalationTicketSummary[]> {
    return [...this.rows.values()]
      .filter((row) => ["Queued", "Assigned", "Active"].includes(row.status))
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority === "High" ? -1 : 1;
        return a.queuedAt.getTime() - b.queuedAt.getTime();
      });
  }

  async findById(ticketId: string): Promise<EscalationTicketDetail | null> {
    return this.rows.get(ticketId) ?? null;
  }

  async listUnrouted(): Promise<readonly EscalationTicketSummary[]> {
    return [...this.rows.values()].filter(
      (row) => row.status === "Queued" && row.routeTargetTeamId === null,
    );
  }

  async assignRouting(ticketId: string, assignment: RouteAssignment): Promise<void> {
    const row = this.rows.get(ticketId);
    if (!row) return;
    this.rows.set(ticketId, { ...row, routeTargetTeamId: assignment.routeTargetTeamId });
  }

  async claim(ticketId: string, staffUserId: string, now: Date): Promise<boolean> {
    const row = this.rows.get(ticketId);
    if (!row || row.status !== "Queued") return false;
    this.rows.set(ticketId, {
      ...row,
      status: "Assigned",
      assignedStaffUserId: staffUserId,
      assignedAt: now,
    });
    return true;
  }

  async markActive(ticketId: string, now: Date): Promise<void> {
    const row = this.rows.get(ticketId);
    if (!row || row.status !== "Assigned") return;
    this.rows.set(ticketId, { ...row, status: "Active", firstResponseAt: now });
  }

  async release(ticketId: string, now: Date): Promise<void> {
    const row = this.rows.get(ticketId);
    if (!row || !["Assigned", "Active"].includes(row.status)) return;
    this.rows.set(ticketId, {
      ...row,
      status: "Queued",
      assignedStaffUserId: null,
      assignedAt: null,
      wasRequeued: true,
    });
    void now;
  }

  async resolve(ticketId: string, status: "Resolved" | "Abandoned", now: Date): Promise<void> {
    const row = this.rows.get(ticketId);
    if (!row || !["Assigned", "Active"].includes(row.status)) return;
    this.rows.set(ticketId, { ...row, status, assignedStaffUserId: null, resolvedAt: now });
  }

  async listHeldBy(staffUserId: string): Promise<readonly EscalationTicketSummary[]> {
    return [...this.rows.values()].filter(
      (row) =>
        row.assignedStaffUserId === staffUserId && ["Assigned", "Active"].includes(row.status),
    );
  }
}

export class FakeAgentPresenceRepository implements AgentPresenceRepository {
  private readonly rows = new Map<string, AgentPresenceRow>();

  seed(row: AgentPresenceRow): void {
    this.rows.set(row.staffUserId, row);
  }

  async getOrCreate(staffUserId: string, now: Date): Promise<AgentPresenceRow> {
    const existing = this.rows.get(staffUserId);
    if (existing) return existing;
    const created: AgentPresenceRow = {
      staffUserId,
      status: "Offline",
      statusChangedAt: now,
      activeTicketCount: 0,
      maxConcurrentTickets: DEFAULT_MAX_CONCURRENT_TICKETS,
      lastHeartbeatAt: now,
    };
    this.rows.set(staffUserId, created);
    return created;
  }

  async setStatus(staffUserId: string, status: PresenceStatus, now: Date): Promise<void> {
    const row = this.rows.get(staffUserId);
    if (!row) return;
    this.rows.set(staffUserId, { ...row, status, statusChangedAt: now, lastHeartbeatAt: now });
  }

  async adjustActiveCount(staffUserId: string, delta: 1 | -1): Promise<void> {
    const row = this.rows.get(staffUserId);
    if (!row) return;
    this.rows.set(staffUserId, { ...row, activeTicketCount: row.activeTicketCount + delta });
  }

  async list(): Promise<readonly AgentPresenceRow[]> {
    return [...this.rows.values()];
  }
}

export class FakeRoutingRuleRepository implements RoutingRuleRepository {
  private readonly rows = new Map<string, RoutingRuleRow>();

  seed(row: RoutingRuleRow): void {
    this.rows.set(row.id, row);
  }

  async list(): Promise<readonly RoutingRuleRow[]> {
    return [...this.rows.values()].sort((a, b) => a.ordinal - b.ordinal);
  }

  async findById(id: string): Promise<RoutingRuleRow | null> {
    return this.rows.get(id) ?? null;
  }

  async nextOrdinal(): Promise<number> {
    const max = Math.max(0, ...[...this.rows.values()].map((row) => row.ordinal));
    return max + 1;
  }

  async create(input: NewRoutingRuleInput): Promise<RoutingRuleRow> {
    const row: RoutingRuleRow = {
      id: fakeId("rule"),
      ordinal: await this.nextOrdinal(),
      attribute: input.attribute,
      operator: input.operator,
      value: input.value,
      targetKind: input.targetKind,
      targetTeamId: input.targetTeamId,
      alertSupervisor: input.alertSupervisor,
      isEnabled: true,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async update(id: string, input: UpdateRoutingRuleInput): Promise<RoutingRuleRow> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`Unknown routing rule "${id}".`);
    const updated: RoutingRuleRow = {
      ...existing,
      attribute: input.attribute,
      operator: input.operator,
      value: input.value,
      targetKind: input.targetKind,
      targetTeamId: input.targetTeamId,
      alertSupervisor: input.alertSupervisor,
      updatedAt: input.now,
    };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  async setEnabled(id: string, isEnabled: boolean, now: Date): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    this.rows.set(id, { ...row, isEnabled, updatedAt: now });
  }

  async reorder(
    orderedIds: readonly string[],
    expectedCurrentOrder: readonly string[],
  ): Promise<void> {
    const currentOrder = (await this.list()).map((row) => row.id);
    const matches =
      currentOrder.length === expectedCurrentOrder.length &&
      currentOrder.every((id, index) => id === expectedCurrentOrder[index]);
    if (!matches) throw new RoutingRuleOrderConflictError(currentOrder);

    orderedIds.forEach((id, index) => {
      const row = this.rows.get(id);
      if (row) this.rows.set(id, { ...row, ordinal: index + 1 });
    });
  }
}

export class FakeRoutingRuleTestRepository implements RoutingRuleTestRepository {
  readonly recorded: RecordRoutingRuleTestInput[] = [];

  async record(input: RecordRoutingRuleTestInput): Promise<{ readonly id: string }> {
    this.recorded.push(input);
    return { id: fakeId("ruletest") };
  }
}

export class FakeCannedReplyRepository implements CannedReplyRepository {
  private readonly rows: CannedReplyRow[] = [];

  seed(row: CannedReplyRow): void {
    this.rows.push(row);
  }

  async listForTopic(topicKey: string, localeCode: string): Promise<readonly CannedReplyRow[]> {
    return this.rows
      .filter(
        (row) =>
          row.isEnabled &&
          row.localeCode === localeCode &&
          (row.topicKey === topicKey || row.topicKey === null),
      )
      .sort((a, b) => a.ordinal - b.ordinal);
  }
}

export class FakeHandoverRoutingConfigRepository implements HandoverRoutingConfigRepository {
  constructor(private row: HandoverRoutingConfigRow | null = null) {}

  seed(row: HandoverRoutingConfigRow): void {
    this.row = row;
  }

  async getSingleton(): Promise<HandoverRoutingConfigRow | null> {
    return this.row;
  }
}

export class FakeTeamRepository implements TeamRepository {
  private readonly rows = new Map<string, TeamOption>();

  seed(row: TeamOption): void {
    this.rows.set(row.id, row);
  }

  async list(): Promise<readonly TeamOption[]> {
    return [...this.rows.values()];
  }

  async findById(id: string): Promise<TeamOption | null> {
    return this.rows.get(id) ?? null;
  }
}

/**
 * A minimal, full-interface fake for `conversation/ports/conversation-repository.ts` —
 * this module is the first *outside* consumer of that port (`GetTicketDetail`'s live
 * transcript read, `SendAgentMessage`'s `appendHumanAgentTurn` write), and no shared
 * fake for it existed yet anywhere in the codebase (confirmed by grep before writing
 * this — every prior `conversation` application use case's own test constructs a
 * narrower ad hoc object instead of a full `ConversationRepository`). Lives here rather
 * than in `conversation/testing/` because this module is the one that needs it; a
 * conversation-module test needing the same shape can promote it later.
 */
export class FakeConversationRepository implements ConversationRepository {
  readonly conversations = new Map<string, ConversationRow>();
  readonly turns = new Map<string, ConversationTurnRow[]>();
  readonly slots = new Map<string, ConversationSlotRow[]>();

  seedConversation(row: ConversationRow): void {
    this.conversations.set(row.id, row);
  }

  seedTurns(conversationId: string, rows: readonly ConversationTurnRow[]): void {
    this.turns.set(conversationId, [...rows]);
  }

  seedSlots(conversationId: string, rows: readonly ConversationSlotRow[]): void {
    this.slots.set(conversationId, [...rows]);
  }

  async create(input: NewConversationInput): Promise<ConversationRow> {
    const row: ConversationRow = {
      id: fakeId("conv"),
      channelKey: input.channelKey,
      localeCode: input.localeCode,
      outcome: "Active",
      turnCount: 0,
      startedAt: input.startedAt,
      lastTurnAt: input.startedAt,
      endedAt: null,
    };
    this.conversations.set(row.id, row);
    return row;
  }

  async findById(conversationId: string): Promise<ConversationRow | null> {
    return this.conversations.get(conversationId) ?? null;
  }

  async listTurnsAfter(
    conversationId: string,
    afterOrdinal: number,
    limit: number,
  ): Promise<readonly ConversationTurnRow[]> {
    return (this.turns.get(conversationId) ?? [])
      .filter((turn) => turn.ordinal > afterOrdinal)
      .sort((a, b) => a.ordinal - b.ordinal)
      .slice(0, limit + 1);
  }

  async listPendingSlots(conversationId: string): Promise<readonly ConversationSlotRow[]> {
    return (this.slots.get(conversationId) ?? []).filter((slot) => slot.status === "Pending");
  }

  async findTurnConversationId(turnId: string): Promise<string | null> {
    for (const [conversationId, rows] of this.turns) {
      if (rows.some((row) => row.id === turnId)) return conversationId;
    }
    return null;
  }

  async close(conversationId: string, outcome: string, endedAt: Date): Promise<void> {
    const row = this.conversations.get(conversationId);
    if (row && !row.endedAt) this.conversations.set(conversationId, { ...row, outcome, endedAt });
  }

  async markEscalated(conversationId: string, now: Date): Promise<void> {
    void now;
    const row = this.conversations.get(conversationId);
    if (row && !row.endedAt)
      this.conversations.set(conversationId, { ...row, outcome: "Escalated" });
  }

  async appendHumanAgentTurn(input: {
    readonly conversationId: string;
    readonly contentMasked: string;
    readonly contentFormat: string;
    readonly now: Date;
  }): Promise<ConversationTurnRow> {
    const existing = this.turns.get(input.conversationId) ?? [];
    const ordinal = Math.max(0, ...existing.map((turn) => turn.ordinal)) + 1;
    const turn: ConversationTurnRow = {
      id: fakeId("turn"),
      conversationId: input.conversationId,
      ordinal,
      role: "HumanAgent",
      contentMasked: input.contentMasked,
      contentFormat: input.contentFormat,
      createdAt: input.now,
      wasRefused: false,
      refusalReason: null,
    };
    this.turns.set(input.conversationId, [...existing, turn]);
    return turn;
  }
}
