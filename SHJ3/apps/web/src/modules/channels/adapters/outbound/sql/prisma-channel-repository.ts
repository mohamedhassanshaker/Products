/** The real `ChannelRepository` — `Channels`, per-tenant (B10 tab 1). */
import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import {
  isChannelKey,
  type ChannelAvailability,
  type ChannelKey,
  type ChannelState,
} from "../../../domain/vocabulary.js";
import type {
  ChannelRepository,
  ChannelRow,
  CreateDefaultChannelInput,
  UpdateChannelInput,
} from "../../../ports/channel-repository.js";

const OPERATION = "channels channel repository";

function toChannelRow(row: {
  id: string;
  key: string;
  displayName: string;
  boundAgentId: string | null;
  boundAgent: { name: string } | null;
  state: string;
  availability: string;
  workingHoursProfileId: string | null;
}): ChannelRow {
  if (!isChannelKey(row.key)) {
    throw new Error(`Channel ${row.id} has an unrecognized key "${row.key}".`);
  }
  return {
    id: row.id,
    key: row.key,
    displayName: row.displayName,
    boundAgentId: row.boundAgentId,
    boundAgentName: row.boundAgent?.name ?? null,
    state: row.state as ChannelState,
    availability: row.availability as ChannelAvailability,
    workingHoursProfileId: row.workingHoursProfileId,
  };
}

export class PrismaChannelRepository implements ChannelRepository {
  async list(): Promise<readonly ChannelRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.channel.findMany({
      include: { boundAgent: { select: { name: true } } },
      orderBy: { key: "asc" },
    });
    return rows.map(toChannelRow);
  }

  async findById(id: string): Promise<ChannelRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.channel.findUnique({
      where: { id },
      include: { boundAgent: { select: { name: true } } },
    });
    return row ? toChannelRow(row) : null;
  }

  async update(input: UpdateChannelInput): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.channel.update({
      where: { id: input.id },
      data: {
        state: input.state,
        boundAgentId: input.boundAgentId,
        ...(input.state === "Live" ? { enabledAt: input.now } : {}),
        ...(input.state === "Disabled" ? { disabledAt: input.now } : {}),
        updatedAt: input.now,
      },
    });
  }

  async countOpenConversations(channelKey: ChannelKey): Promise<number> {
    const db = getTenantDb(OPERATION);
    return db.conversation.count({ where: { channelKey, outcome: "Active" } });
  }

  async createDefault(input: CreateDefaultChannelInput): Promise<ChannelRow> {
    const db = getTenantDb(OPERATION);
    const row = await db.channel.create({
      data: {
        id: newUlid(input.now),
        key: input.key,
        displayName: input.displayName,
        state: "Disabled",
        availability: "TwentyFourSeven",
        disabledAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      },
      include: { boundAgent: { select: { name: true } } },
    });
    return toChannelRow(row);
  }
}
