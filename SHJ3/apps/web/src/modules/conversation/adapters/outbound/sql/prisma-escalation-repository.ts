import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  EscalationRepository,
  EscalationTicketRow,
  HandoverConfigRow,
  NewEscalationTicketInput,
  WorkingHoursProfileRow,
  WorkingHoursSlotRow,
} from "../../../ports/escalation-repository.js";

export class PrismaEscalationRepository implements EscalationRepository {
  async create(input: NewEscalationTicketInput): Promise<EscalationTicketRow> {
    const row = await getTenantDb().escalationTicket.create({
      data: {
        id: newUlid(input.queuedAt),
        conversationId: input.conversationId,
        topic: input.topic,
        topicKey: input.topicKey,
        channelKey: input.channelKey,
        priority: input.priority,
        reason: input.reason,
        reasonDetail: input.reasonDetail,
        verificationState: input.verificationState,
        pendingSlotName: input.pendingSlotName,
        contextSnapshotJson: input.contextSnapshotJson,
        status: "Queued",
        wasRequeued: false,
        queuedAt: input.queuedAt,
        createdAt: input.queuedAt,
      },
    });
    return {
      id: row.id,
      conversationId: row.conversationId,
      status: row.status,
      queuedAt: row.queuedAt,
    };
  }

  async findOpenForConversation(conversationId: string): Promise<EscalationTicketRow | null> {
    const row = await getTenantDb().escalationTicket.findFirst({
      where: { conversationId, status: { in: ["Queued", "Assigned", "Active"] } },
    });
    return row
      ? {
          id: row.id,
          conversationId: row.conversationId,
          status: row.status,
          queuedAt: row.queuedAt,
        }
      : null;
  }

  async countQueuedAhead(beforeQueuedAt: Date): Promise<number> {
    return getTenantDb().escalationTicket.count({
      where: { status: "Queued", queuedAt: { lt: beforeQueuedAt } },
    });
  }

  async findHandoverConfig(): Promise<HandoverConfigRow | null> {
    const row = await getTenantDb().handoverConfig.findUnique({ where: { singletonKey: 1 } });
    return row
      ? {
          noAgentAvailableMessage: row.noAgentAvailableMessage,
          workingHoursProfileId: row.workingHoursProfileId,
          offerEscalationOutsideHours: row.offerEscalationOutsideHours,
        }
      : null;
  }

  async findWorkingHoursProfile(profileId: string): Promise<WorkingHoursProfileRow | null> {
    const row = await getTenantDb().workingHoursProfile.findUnique({ where: { id: profileId } });
    return row
      ? {
          timezone: row.timezone,
          assistantAvailable247: row.assistantAvailable247,
          noAgentAvailableMessage: row.noAgentAvailableMessage,
        }
      : null;
  }

  async listWorkingHoursSlots(profileId: string): Promise<readonly WorkingHoursSlotRow[]> {
    const rows = await getTenantDb().workingHoursSlot.findMany({
      where: { workingHoursProfileId: profileId },
    });
    return rows.map((row) => ({
      dayOfWeek: row.dayOfWeek,
      opensAt: formatTimeOfDay(row.opensAt),
      closesAt: formatTimeOfDay(row.closesAt),
    }));
  }

  async isHoliday(dateIso: string): Promise<boolean> {
    const found = await getTenantDb().publicHoliday.findUnique({
      where: { holidayDate: new Date(`${dateIso}T00:00:00.000Z`) },
    });
    return found !== null && found.isObserved;
  }
}

/** Prisma returns `@db.Time` as a `Date` on the Unix epoch day — only the wall-clock portion is meaningful. */
function formatTimeOfDay(value: Date): string {
  const hh = String(value.getUTCHours()).padStart(2, "0");
  const mm = String(value.getUTCMinutes()).padStart(2, "0");
  const ss = String(value.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
