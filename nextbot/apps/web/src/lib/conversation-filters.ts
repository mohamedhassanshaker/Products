import type { ConversationListFilters } from "@nextbot/conversations";
import type { ConversationStatusValue } from "@nextbot/contracts";

const VALID_STATUSES: ConversationStatusValue[] = ["Active", "Resolved", "Escalated", "Abandoned"];

/**
 * Parses `?channelId=&status=&recognizedGoal=&language=&startedAfter=&startedBefore=`
 * query params into `ConversationListFilters` (screen inventory B.4.1). Every value is
 * caller-supplied — validated here (never trusted verbatim into a date/enum) before it
 * reaches the tenant-scoped query layer.
 */
export function parseConversationFilters(searchParams: URLSearchParams): ConversationListFilters {
  const filters: ConversationListFilters = {};

  const channelId = searchParams.get("channelId");
  if (channelId) filters.channelId = channelId;

  const status = searchParams.get("status");
  if (status && (VALID_STATUSES as string[]).includes(status)) filters.status = status as ConversationStatusValue;

  const recognizedGoal = searchParams.get("recognizedGoal");
  if (recognizedGoal) filters.recognizedGoal = recognizedGoal;

  const language = searchParams.get("language");
  if (language) filters.language = language;

  const startedAfter = searchParams.get("startedAfter");
  if (startedAfter) {
    const parsed = new Date(startedAfter);
    if (!Number.isNaN(parsed.getTime())) filters.startedAfter = parsed;
  }

  const startedBefore = searchParams.get("startedBefore");
  if (startedBefore) {
    const parsed = new Date(startedBefore);
    if (!Number.isNaN(parsed.getTime())) filters.startedBefore = parsed;
  }

  const limit = searchParams.get("limit");
  if (limit) {
    const parsedLimit = Number.parseInt(limit, 10);
    if (Number.isFinite(parsedLimit) && parsedLimit > 0) filters.limit = parsedLimit;
  }

  const offset = searchParams.get("offset");
  if (offset) {
    const parsedOffset = Number.parseInt(offset, 10);
    if (Number.isFinite(parsedOffset) && parsedOffset >= 0) filters.offset = parsedOffset;
  }

  return filters;
}
