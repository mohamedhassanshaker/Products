/**
 * `POST /api/public/v1/conversations/{id}/handover` (api.md §4.2).
 *
 * **Honest scope trims, named rather than hidden:**
 *  - `topicKey` is always `"General"` and `priority` always `"Normal"` — a
 *    real per-flow topic/priority derivation would read the conversation's
 *    current flow node (`modules/flows`, a sibling feature module this one
 *    may not import) and is out of scope for this pass.
 *  - `estimatedWaitSeconds` is `queuePosition * AVERAGE_TICKET_HANDLE_SECONDS`
 *    — a static, documented estimate, not a measured historical average
 *    (which would need B8's own ticket-duration analytics, not built by this
 *    wave).
 */

import { requireOwnConversation, ConversationNotFoundError } from "./conversation-not-found.js";
import { isCurrentlyStaffed, type WallClockNow } from "../domain/working-hours.js";
import type { PublicChannelKind } from "../domain/channel-key.js";
import type { ConversationRepository } from "../ports/conversation-repository.js";
import type { EscalationRepository } from "../ports/escalation-repository.js";

export class HandoverUnavailableError extends Error {
  readonly code = "handover.unavailable";
  readonly status = 409;
  constructor(readonly outOfHoursMessage: string) {
    super(outOfHoursMessage);
    this.name = "HandoverUnavailableError";
  }
}

const AVERAGE_TICKET_HANDLE_SECONDS = 90;

export interface RequestHandoverResult {
  readonly ticketId: string;
  readonly queuePosition: number;
  readonly estimatedWaitSeconds: number;
  readonly contextTransferred: true;
}

export class RequestHandover {
  constructor(
    private readonly deps: {
      readonly conversations: ConversationRepository;
      readonly escalations: EscalationRepository;
    },
  ) {}

  async execute(input: {
    readonly conversationId: string;
    readonly sessionSubjectId: string;
    readonly channelKind: PublicChannelKind;
    readonly reasonDetail: string;
    readonly now: Date;
  }): Promise<RequestHandoverResult> {
    requireOwnConversation(input.sessionSubjectId, input.conversationId);

    const conversation = await this.deps.conversations.findById(input.conversationId);
    if (!conversation) throw new ConversationNotFoundError();

    const existing = await this.deps.escalations.findOpenForConversation(input.conversationId);
    if (existing) {
      const queuePosition = await this.deps.escalations.countQueuedAhead(existing.queuedAt);
      return {
        ticketId: existing.id,
        queuePosition,
        estimatedWaitSeconds: queuePosition * AVERAGE_TICKET_HANDLE_SECONDS,
        contextTransferred: true,
      };
    }

    const handoverConfig = await this.deps.escalations.findHandoverConfig();
    if (handoverConfig) {
      const profile = await this.deps.escalations.findWorkingHoursProfile(
        handoverConfig.workingHoursProfileId,
      );
      if (profile && !profile.assistantAvailable247) {
        const slots = await this.deps.escalations.listWorkingHoursSlots(
          handoverConfig.workingHoursProfileId,
        );
        const wallClock = wallClockNowIn(profile.timezone, input.now);
        const dateIso = isoDateIn(profile.timezone, input.now);
        const holiday = await this.deps.escalations.isHoliday(dateIso);
        const staffed = isCurrentlyStaffed(wallClock, slots, {
          assistantAvailable247: profile.assistantAvailable247,
          isHoliday: holiday,
        });
        if (!staffed && !handoverConfig.offerEscalationOutsideHours) {
          throw new HandoverUnavailableError(
            profile.noAgentAvailableMessage || handoverConfig.noAgentAvailableMessage,
          );
        }
      }
    }

    const [slots, turns] = await Promise.all([
      this.deps.conversations.listPendingSlots(input.conversationId),
      this.deps.conversations.listTurnsAfter(input.conversationId, 0, 1000),
    ]);
    const pendingSlot = slots[0] ?? null;
    // Already-masked data, copied verbatim — never re-derived from raw input
    // (api.md §4.2's own note). `turns` here is at most 1001 rows read
    // straight from `ConversationTurns.contentMasked`.
    const contextSnapshotJson = JSON.stringify({
      turns: turns.map((turn) => ({
        role: turn.role,
        contentMasked: turn.contentMasked,
        ordinal: turn.ordinal,
      })),
      pendingSlot,
    });

    const created = await this.deps.escalations.create({
      conversationId: input.conversationId,
      topic: "General inquiry",
      topicKey: "General",
      channelKey: input.channelKind,
      priority: "Normal",
      reason: "UserRequest",
      reasonDetail: input.reasonDetail,
      verificationState: "L0",
      pendingSlotName: pendingSlot?.name ?? null,
      contextSnapshotJson,
      queuedAt: input.now,
    });

    // FR-CONV-14: "`Escalated` when a handover ticket is created" — applied
    // the instant the ticket exists, not deferred to an explicit close call.
    await this.deps.conversations.markEscalated(input.conversationId, input.now);

    const queuePosition = await this.deps.escalations.countQueuedAhead(created.queuedAt);
    return {
      ticketId: created.id,
      queuePosition,
      estimatedWaitSeconds: queuePosition * AVERAGE_TICKET_HANDLE_SECONDS,
      contextTransferred: true,
    };
  }
}

function wallClockNowIn(timeZone: string, now: Date): WallClockNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    dayOfWeek: weekdayIndex < 0 ? 0 : weekdayIndex,
    timeOfDay: `${get("hour")}:${get("minute")}:${get("second")}`,
  };
}

function isoDateIn(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
