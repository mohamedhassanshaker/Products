"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { SubTabBar, SubTabBarPanel } from "@/components/ui/sub-tab-bar";
import type { AgentPresenceRow } from "../../../../modules/escalation/ports/agent-presence-repository.js";
import type { RoutingRuleRow } from "../../../../modules/escalation/ports/routing-rule-repository.js";
import type { TeamOption } from "../../../../modules/escalation/ports/team-repository.js";
import type { EscalationTicketSummary } from "../../../../modules/escalation/ports/ticket-repository.js";
import { QueueTab } from "./queue-tab.js";
import { RoutingRulesTab } from "./routing-rules-tab.js";
import type {
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

export interface EscalationsScreenActions {
  readonly setAgentPresence: typeof setAgentPresenceAction;
  readonly claimTicket: typeof claimTicketAction;
  readonly releaseTicket: typeof releaseTicketAction;
  readonly resolveTicket: typeof resolveTicketAction;
  readonly getTicketDetail: typeof getTicketDetailAction;
  readonly listCannedReplies: typeof listCannedRepliesAction;
  readonly sendAgentMessage: typeof sendAgentMessageAction;
  readonly createRoutingRule: typeof createRoutingRuleAction;
  readonly updateRoutingRule: typeof updateRoutingRuleAction;
  readonly deleteRoutingRule: typeof deleteRoutingRuleAction;
  readonly setRoutingRuleEnabled: typeof setRoutingRuleEnabledAction;
  readonly reorderRoutingRules: typeof reorderRoutingRulesAction;
  readonly testRoutingRules: typeof testRoutingRulesAction;
}

export interface EscalationsScreenProps {
  readonly canHandle: boolean;
  readonly canManageRouting: boolean;
  readonly queue: readonly (EscalationTicketSummary & { readonly waitTimeMinutes: number })[];
  readonly presence: AgentPresenceRow | null;
  readonly rules: readonly RoutingRuleRow[];
  readonly teams: readonly TeamOption[];
  readonly localeCode: string;
  readonly actions: EscalationsScreenActions;
}

/** B8 in full — the escalation queue/workspace tab (`escalations:handle`) and the
 *  routing-rule manager + tester tab (`routing:manage`). Only the tabs a principal
 *  actually holds the permission for are rendered at all — never a visible-but-disabled
 *  tab, matching this app's own deny-by-default convention. */
export function EscalationsScreen({
  canHandle,
  canManageRouting,
  queue,
  presence,
  rules,
  teams,
  localeCode,
  actions,
}: EscalationsScreenProps): React.ReactElement {
  const t = useTranslations("escalations");

  const tabs = React.useMemo(() => {
    const list: { value: string; label: string }[] = [];
    if (canHandle) list.push({ value: "queue", label: t("tabs.queue") });
    if (canManageRouting) list.push({ value: "routing-rules", label: t("tabs.routingRules") });
    return list;
  }, [canHandle, canManageRouting, t]);

  return (
    <SubTabBar tabs={tabs} aria-label={t("tabsAriaLabel")} urlParam="tab">
      {canHandle ? (
        <SubTabBarPanel value="queue">
          <QueueTab
            initialQueue={queue}
            initialPresence={presence}
            localeCode={localeCode}
            actions={actions}
          />
        </SubTabBarPanel>
      ) : null}
      {canManageRouting ? (
        <SubTabBarPanel value="routing-rules">
          <RoutingRulesTab initialRules={rules} teams={teams} actions={actions} />
        </SubTabBarPanel>
      ) : null}
    </SubTabBar>
  );
}
