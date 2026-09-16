/**
 * Composition root for every `/api/public/v1/*` route handler — the one
 * place allowed to name concrete adapters, mirroring `(backoffice)/knowledge/
 * composition.ts`'s own convention exactly (see that file's doc comment).
 */

import { PrismaConversationRepository } from "../../../../../modules/conversation/adapters/outbound/sql/prisma-conversation-repository.js";
import { PrismaWidgetChannelRepository } from "../../../../../modules/conversation/adapters/outbound/sql/prisma-widget-channel-repository.js";
import { PrismaQuickActionRepository } from "../../../../../modules/conversation/adapters/outbound/sql/prisma-quick-action-repository.js";
import { PrismaFeedbackRepository } from "../../../../../modules/conversation/adapters/outbound/sql/prisma-feedback-repository.js";
import { PrismaEscalationRepository } from "../../../../../modules/conversation/adapters/outbound/sql/prisma-escalation-repository.js";
import { RedisTurnCoordination } from "../../../../../modules/conversation/adapters/outbound/cache/redis-turn-coordination.js";
import { RedisSessionStore } from "../../../../../modules/iam/adapters/outbound/redis-session-store.js";

export function conversationRepository(): PrismaConversationRepository {
  return new PrismaConversationRepository();
}
export function widgetChannelRepository(): PrismaWidgetChannelRepository {
  return new PrismaWidgetChannelRepository();
}
export function quickActionRepository(): PrismaQuickActionRepository {
  return new PrismaQuickActionRepository();
}
export function feedbackRepository(): PrismaFeedbackRepository {
  return new PrismaFeedbackRepository();
}
export function escalationRepository(): PrismaEscalationRepository {
  return new PrismaEscalationRepository();
}
export function turnCoordination(): RedisTurnCoordination {
  return new RedisTurnCoordination();
}
export function sessionStore(): RedisSessionStore {
  return new RedisSessionStore();
}

export function now(): Date {
  return new Date();
}
