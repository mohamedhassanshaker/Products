import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import type {
  EscalationTicketDetail,
  EscalationTicketSummary,
  RouteAssignment,
  TicketRepository,
} from "../../../ports/ticket-repository.js";

const OPEN_STATUSES = ["Queued", "Assigned", "Active"] as const;

function toSummary(row: {
  id: string;
  conversationId: string;
  topic: string;
  topicKey: string;
  channelKey: string;
  priority: string;
  reason: string;
  reasonDetail: string;
  status: string;
  routeTargetTeamId: string | null;
  assignedStaffUserId: string | null;
  queuedAt: Date;
  wasRequeued: boolean;
}): EscalationTicketSummary {
  return {
    id: row.id,
    conversationId: row.conversationId,
    topic: row.topic,
    topicKey: row.topicKey,
    channelKey: row.channelKey,
    priority: row.priority,
    reason: row.reason,
    reasonDetail: row.reasonDetail,
    status: row.status,
    routeTargetTeamId: row.routeTargetTeamId,
    assignedStaffUserId: row.assignedStaffUserId,
    queuedAt: row.queuedAt,
    wasRequeued: row.wasRequeued,
  };
}

export class PrismaTicketRepository implements TicketRepository {
  async listOpen(): Promise<readonly EscalationTicketSummary[]> {
    const rows = await getTenantDb("escalation queue").escalationTicket.findMany({
      where: { status: { in: [...OPEN_STATUSES] } },
      orderBy: [{ priority: "desc" }, { queuedAt: "asc" }],
    });
    return rows.map(toSummary);
  }

  async findById(ticketId: string): Promise<EscalationTicketDetail | null> {
    const row = await getTenantDb("escalation ticket detail").escalationTicket.findUnique({
      where: { id: ticketId },
    });
    if (!row) return null;
    return {
      ...toSummary(row),
      verificationState: row.verificationState,
      citizenIdentityId: row.citizenIdentityId,
      pendingSlotName: row.pendingSlotName,
      contextSnapshotJson: row.contextSnapshotJson,
      assignedAt: row.assignedAt,
      firstResponseAt: row.firstResponseAt,
      resolvedAt: row.resolvedAt,
    };
  }

  async listUnrouted(): Promise<readonly EscalationTicketSummary[]> {
    const rows = await getTenantDb("escalation queue routing sweep").escalationTicket.findMany({
      where: { status: "Queued", routedByRoutingRuleId: null, routeTargetTeamId: null },
      orderBy: { queuedAt: "asc" },
    });
    return rows.map(toSummary);
  }

  async assignRouting(ticketId: string, assignment: RouteAssignment): Promise<void> {
    await getTenantDb("escalation routing assignment").escalationTicket.update({
      where: { id: ticketId },
      data: {
        routedByRoutingRuleId: assignment.routedByRoutingRuleId,
        routeTargetTeamId: assignment.routeTargetTeamId,
      },
    });
  }

  async claim(ticketId: string, staffUserId: string, now: Date): Promise<boolean> {
    // Conditional update — the WHERE clause is the atomicity: only a genuinely
    // `Queued` row is touched, so a concurrent second claimant's identical statement
    // affects zero rows rather than racing on a read-then-write (this project's own
    // established "the grant/constraint is the control" discipline, applied here to a
    // status transition instead of a database grant).
    const result = await getTenantDb("escalation ticket claim").escalationTicket.updateMany({
      where: { id: ticketId, status: "Queued" },
      data: { status: "Assigned", assignedStaffUserId: staffUserId, assignedAt: now },
    });
    return result.count === 1;
  }

  async markActive(ticketId: string, now: Date): Promise<void> {
    await getTenantDb("escalation ticket first response").escalationTicket.updateMany({
      where: { id: ticketId, status: "Assigned" },
      data: { status: "Active", firstResponseAt: now },
    });
  }

  async release(ticketId: string, now: Date): Promise<void> {
    // CK_EscalationTickets_assignedPaired: leaving Assigned/Active requires
    // assignedStaffUserId to become null in the same statement.
    await getTenantDb("escalation ticket release").escalationTicket.updateMany({
      where: { id: ticketId, status: { in: ["Assigned", "Active"] } },
      data: {
        status: "Queued",
        assignedStaffUserId: null,
        assignedAt: null,
        wasRequeued: true,
        updatedAt: now,
      },
    });
  }

  async resolve(ticketId: string, status: "Resolved" | "Abandoned", now: Date): Promise<void> {
    // Same constraint, same reason: assignedStaffUserId must clear on the way out of
    // Assigned/Active — there is no `resolvedByStaffUserId` column (§ domain doc
    // comment); "who closed it" belongs to the audit log, not this row.
    await getTenantDb("escalation ticket resolve").escalationTicket.updateMany({
      where: { id: ticketId, status: { in: ["Assigned", "Active"] } },
      data: { status, assignedStaffUserId: null, resolvedAt: now, updatedAt: now },
    });
  }

  async listHeldBy(staffUserId: string): Promise<readonly EscalationTicketSummary[]> {
    const rows = await getTenantDb("escalation tickets held by agent").escalationTicket.findMany({
      where: { assignedStaffUserId: staffUserId, status: { in: ["Assigned", "Active"] } },
    });
    return rows.map(toSummary);
  }
}
