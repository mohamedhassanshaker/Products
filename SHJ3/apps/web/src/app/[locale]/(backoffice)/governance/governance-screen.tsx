"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { SubTabBar, SubTabBarPanel } from "@/components/ui/sub-tab-bar";
import type { EnvironmentRow } from "../../../../modules/governance/ports/environment-repository.js";
import type { PromotionRequestRow } from "../../../../modules/governance/ports/promotion-repository.js";
import type { AuditLogPage } from "../../../../modules/governance/ports/audit-log-repository.js";
import type { ServiceHealthSampleRow } from "../../../../modules/governance/ports/service-health-repository.js";
import type { ErasureRequestRow } from "../../../../modules/governance/ports/erasure-request-repository.js";
import type { GetPrivacyConfigResult } from "../../../../modules/governance/application/get-privacy-config.js";
import { EnvironmentsTab } from "./environments-tab.js";
import { AuditLogTab } from "./audit-log-tab.js";
import { ObservabilityTab } from "./observability-tab.js";
import { PrivacyTab } from "./privacy-tab.js";
import type {
  approvePromotionAction,
  createErasureRequestAction,
  getAuditEntryAction,
  getObservabilityAction,
  getPrivacyConfigAction,
  listAuditLogAction,
  listErasureRequestsAction,
  listRetentionSweepRunsAction,
  processErasureRequestAction,
  recomputeObservabilityAction,
  rejectPromotionAction,
  requestPromotionAction,
  runRetentionSweepAction,
  updatePrivacyConfigAction,
} from "./actions.js";

export interface GovernanceScreenActions {
  readonly requestPromotion: typeof requestPromotionAction;
  readonly approvePromotion: typeof approvePromotionAction;
  readonly rejectPromotion: typeof rejectPromotionAction;
  readonly listAuditLog: typeof listAuditLogAction;
  readonly getAuditEntry: typeof getAuditEntryAction;
  readonly getObservability: typeof getObservabilityAction;
  readonly recomputeObservability: typeof recomputeObservabilityAction;
  readonly getPrivacyConfig: typeof getPrivacyConfigAction;
  readonly updatePrivacyConfig: typeof updatePrivacyConfigAction;
  readonly listErasureRequests: typeof listErasureRequestsAction;
  readonly createErasureRequest: typeof createErasureRequestAction;
  readonly processErasureRequest: typeof processErasureRequestAction;
  readonly runRetentionSweep: typeof runRetentionSweepAction;
  readonly listRetentionSweepRuns: typeof listRetentionSweepRunsAction;
}

export interface GovernanceScreenProps {
  readonly environments: readonly EnvironmentRow[];
  readonly pendingPromotions: readonly PromotionRequestRow[];
  readonly auditLog: AuditLogPage;
  readonly observability: readonly ServiceHealthSampleRow[];
  readonly privacyConfig: GetPrivacyConfigResult;
  readonly erasureRequests: readonly ErasureRequestRow[];
  readonly actions: GovernanceScreenActions;
}

/** B14 in full — four tabs, one permission (`governance:manage`). */
export function GovernanceScreen({
  environments,
  pendingPromotions,
  auditLog,
  observability,
  privacyConfig,
  erasureRequests,
  actions,
}: GovernanceScreenProps): React.ReactElement {
  const t = useTranslations("governance");

  const tabs = React.useMemo(
    () => [
      { value: "environments", label: t("tabs.environments") },
      { value: "audit-log", label: t("tabs.auditLog") },
      { value: "observability", label: t("tabs.observability") },
      { value: "privacy", label: t("tabs.privacy") },
    ],
    [t],
  );

  return (
    <SubTabBar tabs={tabs} aria-label={t("tabsAriaLabel")} urlParam="tab">
      <SubTabBarPanel value="environments">
        <EnvironmentsTab
          initialEnvironments={environments}
          initialPendingPromotions={pendingPromotions}
          actions={actions}
        />
      </SubTabBarPanel>
      <SubTabBarPanel value="audit-log">
        <AuditLogTab initialPage={auditLog} actions={actions} />
      </SubTabBarPanel>
      <SubTabBarPanel value="observability">
        <ObservabilityTab initialSamples={observability} actions={actions} />
      </SubTabBarPanel>
      <SubTabBarPanel value="privacy">
        <PrivacyTab
          initialConfig={privacyConfig}
          initialErasureRequests={erasureRequests}
          actions={actions}
        />
      </SubTabBarPanel>
    </SubTabBar>
  );
}
