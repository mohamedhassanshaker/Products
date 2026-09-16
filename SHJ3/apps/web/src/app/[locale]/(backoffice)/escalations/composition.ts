/**
 * Composition helpers for `/escalations` (B-7 Handover) — identical precedent to
 * `channels/composition.ts`: thin, stateless wrappers over `getTenantDb()`, constructed
 * fresh per call, the one place in this route allowed to name concrete adapters.
 */
import { PrismaConversationRepository } from "../../../../modules/conversation/adapters/outbound/sql/prisma-conversation-repository.js";
import { PrismaCitizenIdentityRepository } from "../../../../modules/identity/adapters/outbound/sql/prisma-citizen-identity-repository.js";
import { PrismaUserRepository } from "../../../../modules/iam/adapters/outbound/sql/prisma-user-repository.js";
import { PrismaAgentPresenceRepository } from "../../../../modules/escalation/adapters/outbound/sql/prisma-agent-presence-repository.js";
import { PrismaCannedReplyRepository } from "../../../../modules/escalation/adapters/outbound/sql/prisma-canned-reply-repository.js";
import { PrismaHandoverRoutingConfigRepository } from "../../../../modules/escalation/adapters/outbound/sql/prisma-handover-routing-config-repository.js";
import { PrismaRoutingRuleRepository } from "../../../../modules/escalation/adapters/outbound/sql/prisma-routing-rule-repository.js";
import { PrismaRoutingRuleTestRepository } from "../../../../modules/escalation/adapters/outbound/sql/prisma-routing-rule-test-repository.js";
import { PrismaTeamRepository } from "../../../../modules/escalation/adapters/outbound/sql/prisma-team-repository.js";
import { PrismaTicketRepository } from "../../../../modules/escalation/adapters/outbound/sql/prisma-ticket-repository.js";

export function ticketRepository(): PrismaTicketRepository {
  return new PrismaTicketRepository();
}
export function agentPresenceRepository(): PrismaAgentPresenceRepository {
  return new PrismaAgentPresenceRepository();
}
export function routingRuleRepository(): PrismaRoutingRuleRepository {
  return new PrismaRoutingRuleRepository();
}
export function routingRuleTestRepository(): PrismaRoutingRuleTestRepository {
  return new PrismaRoutingRuleTestRepository();
}
export function cannedReplyRepository(): PrismaCannedReplyRepository {
  return new PrismaCannedReplyRepository();
}
export function handoverRoutingConfigRepository(): PrismaHandoverRoutingConfigRepository {
  return new PrismaHandoverRoutingConfigRepository();
}
export function teamRepository(): PrismaTeamRepository {
  return new PrismaTeamRepository();
}
export function conversationRepository(): PrismaConversationRepository {
  return new PrismaConversationRepository();
}
export function citizenIdentityRepository(): PrismaCitizenIdentityRepository {
  return new PrismaCitizenIdentityRepository();
}
export function userRepository(): PrismaUserRepository {
  return new PrismaUserRepository();
}

export function now(): Date {
  return new Date();
}
