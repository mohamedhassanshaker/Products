import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { isAllowed } from "../../../../modules/iam/domain/permissions.js";
import { GetAgentPresence } from "../../../../modules/escalation/application/get-agent-presence.js";
import { ListEscalationQueue } from "../../../../modules/escalation/application/list-escalation-queue.js";
import { ListRoutingRules } from "../../../../modules/escalation/application/list-routing-rules.js";
import type { AgentPresenceRow } from "../../../../modules/escalation/ports/agent-presence-repository.js";
import type { RoutingRuleRow } from "../../../../modules/escalation/ports/routing-rule-repository.js";
import type { TeamOption } from "../../../../modules/escalation/ports/team-repository.js";
import type { EscalationTicketSummary } from "../../../../modules/escalation/ports/ticket-repository.js";
import {
  agentPresenceRepository,
  handoverRoutingConfigRepository,
  now,
  routingRuleRepository,
  teamRepository,
  ticketRepository,
} from "./composition.js";
import { EscalationsScreen } from "./escalations-screen.js";
import {
  claimTicketAction,
  createRoutingRuleAction,
  deleteRoutingRuleAction,
  getTicketDetailAction,
  listCannedRepliesAction,
  releaseTicketAction,
  reorderRoutingRulesAction,
  resolveTicketAction,
  sendAgentMessageAction,
  setAgentPresenceAction,
  setRoutingRuleEnabledAction,
  testRoutingRulesAction,
  updateRoutingRuleAction,
} from "./actions.js";

type PageData =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | {
      readonly kind: "ok";
      readonly canHandle: boolean;
      readonly canManageRouting: boolean;
      readonly queue: readonly (EscalationTicketSummary & { readonly waitTimeMinutes: number })[];
      readonly presence: AgentPresenceRow | null;
      readonly rules: readonly RoutingRuleRow[];
      readonly teams: readonly TeamOption[];
      readonly localeCode: string;
    };

/**
 * `/escalations` (B8: Human agent workspace — the checklist's own "B-7 · Handover")
 *
 * Two real permissions gate two real halves of one screen: `escalations:handle` (the
 * queue, presence, per-ticket workspace — granted to `LiveAgent` and `SuperAdmin`) and
 * `routing:manage` (the routing-rule manager + tester — granted to `SuperAdmin` and
 * `EntityAdmin`). A principal needs *at least one* to see the page at all; each tab
 * renders only if its own permission is held — a `LiveAgent` never sees the routing-rule
 * manager, an `EntityAdmin` never sees the live queue, and a `SuperAdmin` sees both,
 * exactly matching B9 tab 3's matrix.
 *
 * Every query runs inside `withStaffAuth`'s handler, never after it returns — the same
 * established precedent `channels/page.tsx`/`tools/page.tsx` already set.
 */
export default async function EscalationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("escalations");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      const canHandle = isAllowed(principal.permissions, "escalations:handle");
      const canManageRouting = isAllowed(principal.permissions, "routing:manage");
      if (!canHandle && !canManageRouting) return { kind: "forbidden" } as const;

      const requestNow = now();
      const [queue, presence, rules, teams] = await Promise.all([
        canHandle
          ? new ListEscalationQueue({
              tickets: ticketRepository(),
              rules: routingRuleRepository(),
              handoverConfig: handoverRoutingConfigRepository(),
            }).execute(requestNow)
          : Promise.resolve([]),
        canHandle
          ? new GetAgentPresence({ presence: agentPresenceRepository() }).execute(
              principal.id,
              requestNow,
            )
          : Promise.resolve(null),
        canManageRouting
          ? new ListRoutingRules({ rules: routingRuleRepository() }).execute()
          : Promise.resolve([]),
        canManageRouting || canHandle ? teamRepository().list() : Promise.resolve([]),
      ]);

      return {
        kind: "ok",
        canHandle,
        canManageRouting,
        queue,
        presence,
        rules,
        teams,
        localeCode: "en",
      } as const;
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      pageData = { kind: "unauthenticated" };
    } else {
      throw error;
    }
  }

  if (pageData.kind === "unauthenticated") {
    const tCommon = await getTranslations("common");
    return (
      <div className="flex flex-col gap-4">
        <SignInPrompt
          heading={t("pageTitle")}
          message={t("signInPrompt")}
          signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/escalations`)}`}
          signInLabel={tCommon("signInCta")}
        />
      </div>
    );
  }

  if (pageData.kind === "forbidden") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold text-foreground">{t("permissionDeniedHeading")}</h1>
        <p className="text-sm text-muted-foreground">{t("permissionDeniedBody")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("pageTitle")}</h1>
      <EscalationsScreen
        canHandle={pageData.canHandle}
        canManageRouting={pageData.canManageRouting}
        queue={pageData.queue}
        presence={pageData.presence}
        rules={pageData.rules}
        teams={pageData.teams}
        localeCode={pageData.localeCode}
        actions={{
          setAgentPresence: setAgentPresenceAction,
          claimTicket: claimTicketAction,
          releaseTicket: releaseTicketAction,
          resolveTicket: resolveTicketAction,
          getTicketDetail: getTicketDetailAction,
          listCannedReplies: listCannedRepliesAction,
          sendAgentMessage: sendAgentMessageAction,
          createRoutingRule: createRoutingRuleAction,
          updateRoutingRule: updateRoutingRuleAction,
          deleteRoutingRule: deleteRoutingRuleAction,
          setRoutingRuleEnabled: setRoutingRuleEnabledAction,
          reorderRoutingRules: reorderRoutingRulesAction,
          testRoutingRules: testRoutingRulesAction,
        }}
      />
    </div>
  );
}
