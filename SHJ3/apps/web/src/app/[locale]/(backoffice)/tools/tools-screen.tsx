"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { SubTabBar, SubTabBarPanel } from "@/components/ui/sub-tab-bar";
import type { ApiConnectorCatalogRow } from "../../../../modules/tools/application/list-api-connectors.js";
import type { CircuitBreakerCatalogRow } from "../../../../modules/tools/application/list-circuit-breakers.js";
import type { SkillCatalogRow } from "../../../../modules/tools/application/list-skills.js";
import type {
  McpServerRow,
  McpToolRow,
} from "../../../../modules/tools/ports/mcp-server-repository.js";
import { SkillsTab } from "./skills-tab.js";
import { McpServersTab } from "./mcp-servers-tab.js";
import { ApiConnectorsTab } from "./api-connectors-tab.js";
import { CircuitBreakersTab } from "./circuit-breakers-tab.js";
import type {
  connectAndDiscoverMcpServerAction,
  createApiConnectorAction,
  createMcpServerAction,
  createNativeSkillAction,
  deleteApiConnectorAction,
  deleteMcpServerAction,
  deleteSkillAction,
  resetCircuitBreakerAction,
  testApiConnectorAction,
  tripCircuitBreakerAction,
  updateApiConnectorAction,
  updateCircuitBreakerConfigAction,
  updateMcpServerAction,
  updateSkillAction,
} from "./actions.js";

/** One discovered MCP tool plus the number of agent versions currently binding it — the same read-only "how widely is this used" number tabs 1 and 3 show for skills and connectors. */
export type McpToolWithBindingCount = McpToolRow & { readonly boundAgentVersionCount: number };

/** A registered MCP server with the tool descriptors already discovered from it (empty until a successful discovery). */
export interface McpServerWithTools {
  readonly server: McpServerRow;
  readonly tools: readonly McpToolWithBindingCount[];
}

/** Every Server Action the four tabs below call — one prop object, so adding a tab needs no new `page.tsx` wiring point. */
export interface ToolsScreenActions {
  readonly createNativeSkill: typeof createNativeSkillAction;
  readonly updateSkill: typeof updateSkillAction;
  readonly deleteSkill: typeof deleteSkillAction;
  readonly createMcpServer: typeof createMcpServerAction;
  readonly updateMcpServer: typeof updateMcpServerAction;
  readonly deleteMcpServer: typeof deleteMcpServerAction;
  readonly connectAndDiscoverMcpServer: typeof connectAndDiscoverMcpServerAction;
  readonly createApiConnector: typeof createApiConnectorAction;
  readonly updateApiConnector: typeof updateApiConnectorAction;
  readonly deleteApiConnector: typeof deleteApiConnectorAction;
  readonly testApiConnector: typeof testApiConnectorAction;
  readonly updateCircuitBreakerConfig: typeof updateCircuitBreakerConfigAction;
  readonly resetCircuitBreaker: typeof resetCircuitBreakerAction;
  readonly tripCircuitBreaker: typeof tripCircuitBreakerAction;
}

export interface ToolsScreenProps {
  readonly skills: readonly SkillCatalogRow[];
  readonly mcpServers: readonly McpServerWithTools[];
  readonly apiConnectors: readonly ApiConnectorCatalogRow[];
  readonly circuitBreakers: readonly CircuitBreakerCatalogRow[];
  readonly actions: ToolsScreenActions;
}

/**
 * B5's four tabs, URL-synced (`?tab=`) through `SubTabBar`'s own `urlParam` mechanism —
 * `iam-screen.tsx`'s established convention, and deep-linkability genuinely matters here: an
 * incident conversation ("the SEWA breaker is open") should be able to link straight at
 * `?tab=resilience` rather than at a screen with instructions to find the right tab.
 *
 * ## No client-side cache of server data
 *
 * All four datasets are props this Server Component page fetched. Every mutation calls its
 * Server Action and then `router.refresh()` (inside each tab), which re-runs `page.tsx`'s own
 * reads — including the binding counts and the live Redis breaker state. That is what keeps
 * "the same underlying data as wizard step 4" honest: nothing here caches or re-derives a
 * count that another screen's bind could have changed a second ago.
 */
export function ToolsScreen({
  skills,
  mcpServers,
  apiConnectors,
  circuitBreakers,
  actions,
}: ToolsScreenProps): React.ReactElement {
  const t = useTranslations("tools");

  const tabs = React.useMemo(
    () => [
      { value: "skills", label: t("tabs.skills") },
      { value: "mcp-servers", label: t("tabs.mcpServers") },
      { value: "api-connectors", label: t("tabs.apiConnectors") },
      { value: "resilience", label: t("tabs.resilience") },
    ],
    [t],
  );

  /**
   * Breaker target id → that target's own display name.
   *
   * A `CircuitBreakerConfig` guarding a connector or an MCP server stores only its `targetId`,
   * so tab 4 would otherwise print a ULID where the operator expects "Fetch SEWA bill". The
   * names already arrived with tabs 2 and 3's rows, so they are joined here rather than fetched
   * again — and this screen is the only place that legitimately knows all three sets at once.
   */
  const breakerTargetNames = React.useMemo<Readonly<Record<string, string>>>(() => {
    const names: Record<string, string> = {};
    for (const connector of apiConnectors) names[connector.id] = connector.name;
    for (const { server } of mcpServers) names[server.id] = server.name;
    return names;
  }, [apiConnectors, mcpServers]);

  return (
    <SubTabBar tabs={tabs} aria-label={t("tabsAriaLabel")} urlParam="tab">
      <SubTabBarPanel value="skills">
        <SkillsTab rows={skills} actions={actions} />
      </SubTabBarPanel>
      <SubTabBarPanel value="mcp-servers">
        <McpServersTab rows={mcpServers} actions={actions} />
      </SubTabBarPanel>
      <SubTabBarPanel value="api-connectors">
        <ApiConnectorsTab rows={apiConnectors} actions={actions} />
      </SubTabBarPanel>
      <SubTabBarPanel value="resilience">
        <CircuitBreakersTab
          rows={circuitBreakers}
          targetNames={breakerTargetNames}
          actions={actions}
        />
      </SubTabBarPanel>
    </SubTabBar>
  );
}
