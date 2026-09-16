"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { SubTabBar, SubTabBarPanel } from "@/components/ui/sub-tab-bar";
import type { GlobalPolicyRow } from "../../../../modules/guardrails/ports/policy-catalogue-repository.js";
import type { PolicyOverrideDirectoryRow } from "../../../../modules/guardrails/ports/policy-override-directory-repository.js";
import { GlobalPoliciesTab } from "./global-policies-tab.js";
import { PolicyOverridesTab } from "./policy-overrides-tab.js";
import type {
  listGuardrailPoliciesAction,
  listPolicyOverridesAction,
  updateGuardrailPolicyValueAction,
} from "./actions.js";

export interface GuardrailsScreenActions {
  readonly listGuardrailPolicies: typeof listGuardrailPoliciesAction;
  readonly updateGuardrailPolicyValue: typeof updateGuardrailPolicyValueAction;
  readonly listPolicyOverrides: typeof listPolicyOverridesAction;
}

export interface GuardrailsScreenProps {
  readonly policies: readonly GlobalPolicyRow[];
  readonly overrides: readonly PolicyOverrideDirectoryRow[];
  readonly locale: string;
  readonly actions: GuardrailsScreenActions;
}

/** Screen 3 in full — two subtabs (wireframe `#screen-guardrails`: "Global policies" /
 *  "Per-agent overrides"), one permission (`governance:manage`). */
export function GuardrailsScreen({
  policies,
  overrides,
  locale,
  actions,
}: GuardrailsScreenProps): React.ReactElement {
  const t = useTranslations("guardrails");

  const tabs = React.useMemo(
    () => [
      { value: "policies", label: t("tabs.policies") },
      { value: "overrides", label: t("tabs.overrides") },
    ],
    [t],
  );

  return (
    <SubTabBar tabs={tabs} aria-label={t("tabsAriaLabel")} urlParam="tab">
      <SubTabBarPanel value="policies">
        <GlobalPoliciesTab initialPolicies={policies} actions={actions} />
      </SubTabBarPanel>
      <SubTabBarPanel value="overrides">
        <PolicyOverridesTab initialOverrides={overrides} locale={locale} />
      </SubTabBarPanel>
    </SubTabBar>
  );
}
