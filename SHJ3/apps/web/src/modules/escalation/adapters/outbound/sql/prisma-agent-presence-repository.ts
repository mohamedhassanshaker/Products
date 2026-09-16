import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import type { PresenceStatus } from "../../../domain/presence.js";
import {
  DEFAULT_MAX_CONCURRENT_TICKETS,
  type AgentPresenceRepository,
  type AgentPresenceRow,
} from "../../../ports/agent-presence-repository.js";

function toRow(row: {
  staffUserId: string;
  status: string;
  statusChangedAt: Date;
  activeTicketCount: number;
  maxConcurrentTickets: number;
  lastHeartbeatAt: Date;
}): AgentPresenceRow {
  return {
    staffUserId: row.staffUserId,
    status: row.status as PresenceStatus,
    statusChangedAt: row.statusChangedAt,
    activeTicketCount: row.activeTicketCount,
    maxConcurrentTickets: row.maxConcurrentTickets,
    lastHeartbeatAt: row.lastHeartbeatAt,
  };
}

export class PrismaAgentPresenceRepository implements AgentPresenceRepository {
  async getOrCreate(staffUserId: string, now: Date): Promise<AgentPresenceRow> {
    const existing = await getTenantDb("agent presence read").agentPresence.findUnique({
      where: { staffUserId },
    });
    if (existing) return toRow(existing);

    const created = await getTenantDb("agent presence create").agentPresence.create({
      data: {
        staffUserId,
        status: "Offline",
        statusChangedAt: now,
        activeTicketCount: 0,
        maxConcurrentTickets: DEFAULT_MAX_CONCURRENT_TICKETS,
        lastHeartbeatAt: now,
        createdAt: now,
      },
    });
    return toRow(created);
  }

  async setStatus(staffUserId: string, status: PresenceStatus, now: Date): Promise<void> {
    await getTenantDb("agent presence set status").agentPresence.update({
      where: { staffUserId },
      data: { status, statusChangedAt: now, lastHeartbeatAt: now, updatedAt: now },
    });
  }

  async adjustActiveCount(staffUserId: string, delta: 1 | -1): Promise<void> {
    await getTenantDb("agent presence active-count adjust").agentPresence.update({
      where: { staffUserId },
      data: { activeTicketCount: { increment: delta } },
    });
  }

  async list(): Promise<readonly AgentPresenceRow[]> {
    const rows = await getTenantDb("agent presence roster").agentPresence.findMany({
      orderBy: { statusChangedAt: "desc" },
    });
    return rows.map(toRow);
  }
}
