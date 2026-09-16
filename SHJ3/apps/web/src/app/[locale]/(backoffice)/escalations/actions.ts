"use server";

/**
 * Server Actions for `/escalations` (B-7: Handover) — every write on this screen.
 *
 * ## Permission gating
 *
 * `escalations:handle` for everything on the queue/ticket/presence side (the real,
 * seeded permission the B9 matrix already grants to `LiveAgent` and `SuperAdmin`
 * alone), `routing:manage` for every routing-rule write (granted to `SuperAdmin`/
 * `EntityAdmin`). Both are real keys in `modules/iam/domain/permissions.ts` — no new
 * permission was invented for this module. Checked here, in the caller, per api.md §12
 * invariant 2 — the use cases in `modules/escalation/application` do not check
 * permissions themselves.
 */
import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { ClaimTicket } from "../../../../modules/escalation/application/claim-ticket.js";
import { CreateRoutingRule } from "../../../../modules/escalation/application/create-routing-rule.js";
import { DeleteRoutingRule } from "../../../../modules/escalation/application/delete-routing-rule.js";
import { ListCannedReplies } from "../../../../modules/escalation/application/list-canned-replies.js";
import { ReleaseTicket } from "../../../../modules/escalation/application/release-ticket.js";
import { ReorderRoutingRules } from "../../../../modules/escalation/application/reorder-routing-rules.js";
import { ResolveTicket } from "../../../../modules/escalation/application/resolve-ticket.js";
import { SendAgentMessage } from "../../../../modules/escalation/application/send-agent-message.js";
import { SetAgentPresence } from "../../../../modules/escalation/application/set-agent-presence.js";
import { SetRoutingRuleEnabled } from "../../../../modules/escalation/application/set-routing-rule-enabled.js";
import {
  TestRoutingRules,
  type RuleSetSpec,
  type TestRoutingRulesResult,
} from "../../../../modules/escalation/application/test-routing-rules.js";
import { UpdateRoutingRule } from "../../../../modules/escalation/application/update-routing-rule.js";
import type { PresenceStatus } from "../../../../modules/escalation/domain/presence.js";
import type {
  RuleAttribute,
  RuleOperator,
  RuleTargetKind,
  TicketSample,
} from "../../../../modules/escalation/domain/routing-rule-engine.js";
import type { AgentPresenceRow } from "../../../../modules/escalation/ports/agent-presence-repository.js";
import type { CannedReplyRow } from "../../../../modules/escalation/ports/canned-reply-repository.js";
import type { RoutingRuleRow } from "../../../../modules/escalation/ports/routing-rule-repository.js";
import type { EscalationTicketDetail } from "../../../../modules/escalation/ports/ticket-repository.js";
import {
  agentPresenceRepository,
  cannedReplyRepository,
  citizenIdentityRepository,
  conversationRepository,
  handoverRoutingConfigRepository,
  now,
  routingRuleRepository,
  routingRuleTestRepository,
  teamRepository,
  ticketRepository,
} from "./composition.js";
import { GetTicketDetail } from "../../../../modules/escalation/application/get-ticket-detail.js";

const HANDLE_PERMISSION = "escalations:handle" as const;
const ROUTING_PERMISSION = "routing:manage" as const;

export type ActionResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Queue / presence / ticket
// ---------------------------------------------------------------------------

export async function setAgentPresenceAction(
  status: PresenceStatus,
): Promise<ActionResult<AgentPresenceRow>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, HANDLE_PERMISSION, "escalations.setAgentPresence");
        const result = await new SetAgentPresence({
          presence: agentPresenceRepository(),
          tickets: ticketRepository(),
        }).execute({ staffUserId: principal.id, status, now: now() });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { status } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function claimTicketAction(
  ticketId: string,
): Promise<ActionResult<EscalationTicketDetail>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, HANDLE_PERMISSION, "escalations.claimTicket");
        const result = await new ClaimTicket({
          tickets: ticketRepository(),
          presence: agentPresenceRepository(),
        }).execute({ ticketId, staffUserId: principal.id, now: now() });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { ticketId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function releaseTicketAction(ticketId: string): Promise<ActionResult<void>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, HANDLE_PERMISSION, "escalations.releaseTicket");
        await new ReleaseTicket({
          tickets: ticketRepository(),
          presence: agentPresenceRepository(),
        }).execute({ ticketId, staffUserId: principal.id, now: now() });
        return { ok: true, value: undefined } as const;
      },
      { method: "POST", body: { ticketId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function resolveTicketAction(
  ticketId: string,
  outcome: "resolved" | "abandoned",
): Promise<ActionResult<void>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, HANDLE_PERMISSION, "escalations.resolveTicket");
        await new ResolveTicket({
          tickets: ticketRepository(),
          presence: agentPresenceRepository(),
        }).execute({ ticketId, staffUserId: principal.id, outcome, now: now() });
        return { ok: true, value: undefined } as const;
      },
      { method: "POST", body: { ticketId, outcome } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export interface TicketDetailActionResult {
  readonly ticket: EscalationTicketDetail;
  readonly transcript: readonly {
    readonly id: string;
    readonly role: string;
    readonly contentMasked: string;
    readonly createdAt: Date;
  }[];
  readonly reasonLabel: string;
  readonly identity: {
    readonly assuranceLevel: string;
    readonly displayNameMasked: string | null;
    readonly verifiedByProviderKey: string | null;
  } | null;
  readonly cannedReplies: readonly CannedReplyRow[];
}

/** Re-fetches full ticket detail — called right after a claim, and by the composer's
 *  own periodic refresh, so the agent always sees the *live* transcript (never a cold
 *  start, even for messages the citizen sends after the agent has already opened the
 *  ticket). */
export async function getTicketDetailAction(
  ticketId: string,
  localeCode: string,
): Promise<ActionResult<TicketDetailActionResult>> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, HANDLE_PERMISSION, "escalations.getTicketDetail");
      const result = await new GetTicketDetail({
        tickets: ticketRepository(),
        conversations: conversationRepository(),
        citizenIdentities: citizenIdentityRepository(),
        cannedReplies: cannedReplyRepository(),
      }).execute(ticketId, localeCode);
      return { ok: true, value: result } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function listCannedRepliesAction(
  ticketId: string,
  localeCode: string,
): Promise<ActionResult<readonly CannedReplyRow[]>> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, HANDLE_PERMISSION, "escalations.listCannedReplies");
      const result = await new ListCannedReplies({
        tickets: ticketRepository(),
        cannedReplies: cannedReplyRepository(),
      }).execute(ticketId, localeCode);
      return { ok: true, value: result } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/**
 * `POST /handover/tickets/{id}/messages` — sends the agent's own composed text.
 *
 * **This is the one action a canned-reply selection must never call.** Selecting a
 * canned reply only ever populates the composer's local `value` state
 * (`queue-tab.tsx`'s own `handleCannedReplySelect`) — it never invokes this action by
 * itself. The agent still has to press Send (or Enter), exactly like typing the message
 * by hand, which is the real behavioural distinction the hard requirement names, proven
 * by `queue-tab.test.tsx`.
 */
export async function sendAgentMessageAction(
  ticketId: string,
  body: string,
): Promise<ActionResult<{ readonly id: string; readonly createdAt: Date }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, HANDLE_PERMISSION, "escalations.sendAgentMessage");
        const turn = await new SendAgentMessage({
          tickets: ticketRepository(),
          conversations: conversationRepository(),
        }).execute({ ticketId, staffUserId: principal.id, body, now: now() });
        return { ok: true, value: { id: turn.id, createdAt: turn.createdAt } } as const;
      },
      { method: "POST", body: { ticketId, body } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Routing rules
// ---------------------------------------------------------------------------

export interface RoutingRuleFormInput {
  readonly attribute: RuleAttribute;
  readonly operator: RuleOperator;
  readonly value: string;
  readonly targetKind: RuleTargetKind;
  readonly targetTeamId: string | null;
  readonly alertSupervisor: boolean;
}

export async function createRoutingRuleAction(
  input: RoutingRuleFormInput,
): Promise<ActionResult<RoutingRuleRow>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, ROUTING_PERMISSION, "escalations.createRoutingRule");
        const result = await new CreateRoutingRule({ rules: routingRuleRepository() }).execute({
          ...input,
          staffUserId: principal.id,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function updateRoutingRuleAction(
  id: string,
  input: RoutingRuleFormInput,
): Promise<ActionResult<RoutingRuleRow>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, ROUTING_PERMISSION, "escalations.updateRoutingRule");
        const result = await new UpdateRoutingRule({ rules: routingRuleRepository() }).execute(id, {
          ...input,
          staffUserId: principal.id,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { id, ...input } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function deleteRoutingRuleAction(id: string): Promise<ActionResult<void>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, ROUTING_PERMISSION, "escalations.deleteRoutingRule");
        await new DeleteRoutingRule({ rules: routingRuleRepository() }).execute(id);
        return { ok: true, value: undefined } as const;
      },
      { method: "POST", body: { id } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function setRoutingRuleEnabledAction(
  id: string,
  isEnabled: boolean,
): Promise<ActionResult<void>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, ROUTING_PERMISSION, "escalations.setRoutingRuleEnabled");
        await new SetRoutingRuleEnabled({ rules: routingRuleRepository() }).execute(
          id,
          isEnabled,
          now(),
        );
        return { ok: true, value: undefined } as const;
      },
      { method: "POST", body: { id, isEnabled } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/** api.md §6.8's `If-Match`-on-`ETag` guarantee, expressed here as "the caller supplies
 *  the order the screen last rendered" (`expectedCurrentOrder`) — see `ReorderRoutingRules`'s
 *  own doc comment. */
export async function reorderRoutingRulesAction(
  orderedIds: readonly string[],
  expectedCurrentOrder: readonly string[],
): Promise<ActionResult<void>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, ROUTING_PERMISSION, "escalations.reorderRoutingRules");
        await new ReorderRoutingRules({ rules: routingRuleRepository() }).execute(
          orderedIds,
          expectedCurrentOrder,
        );
        return { ok: true, value: undefined } as const;
      },
      { method: "PUT", body: { orderedIds, expectedCurrentOrder } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/**
 * The rule tester — records a real `RoutingRuleTests` audit row every run
 * (`TestRoutingRules`'s own doc comment: "so a pre-live check is evidence rather than a
 * transient reassurance"), never mutates routing state. Gated on `routing:manage`, the
 * same permission as every other routing-rule write, since the tester is part of that
 * same screen.
 */
export async function testRoutingRulesAction(
  ticket: TicketSample,
  ruleSet: RuleSetSpec,
): Promise<ActionResult<TestRoutingRulesResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, ROUTING_PERMISSION, "escalations.testRoutingRules");
        const result = await new TestRoutingRules({
          rules: routingRuleRepository(),
          teams: teamRepository(),
          handoverConfig: handoverRoutingConfigRepository(),
          tests: routingRuleTestRepository(),
        }).execute({ ticket, ruleSet, staffUserId: principal.id, now: now() });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { ticket, ruleSet } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}
