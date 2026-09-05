import { AccessDeniedState } from "@nextbot/ui";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@nextbot/ui/components/ui/tabs";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { McpHealthDashboard } from "./McpHealthDashboard";
import { ConnectorAlertConfig } from "./ConnectorAlertConfig";

/**
 * B.3A.4 MCP Server Health & Monitoring (RBAC module: `connectors`).
 *
 * Plan Phase 3 (client-feedback-batch item 11): now hosts two tabs — "Health"
 * (the original, unchanged dashboard) and "Alert Configuration" (relocated
 * here from the standalone `/settings/connector-alerts` screen, which now
 * redirects to `?tab=alerts`). Both tabs share the same RBAC gate
 * (`connectors`) and the same resolved `permissionLevel`, since
 * `ConnectorAlertConfig`'s own gating was already identical to this page's —
 * no new permission surface introduced by the merge.
 *
 * `tab` is read server-side from the URL (Next.js 15 async `searchParams`) and
 * used only as the `Tabs` primitive's *initial* selection — Base UI's `Tabs`
 * is otherwise uncontrolled here, so a user can freely switch tabs afterward
 * without this page needing client-side URL-sync machinery it doesn't
 * otherwise need.
 */
export default async function McpHealthPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const level = await getModuleAccessLevel("connectors");
  if (level === "None") return <AccessDeniedState moduleLabel="MCP Health" />;

  const { tab } = await searchParams;
  const defaultTab = tab === "alerts" ? "alerts" : "health";

  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList aria-label="MCP Health sections" className="mx-6 mt-6">
        <TabsTrigger id="mcp-health-tab-health" panelId="mcp-health-panel-health" value="health">Health</TabsTrigger>
        <TabsTrigger id="mcp-health-tab-alerts" panelId="mcp-health-panel-alerts" value="alerts">Alert Configuration</TabsTrigger>
      </TabsList>
      <TabsContent id="mcp-health-panel-health" value="health">
        <McpHealthDashboard permissionLevel={level} />
      </TabsContent>
      <TabsContent id="mcp-health-panel-alerts" value="alerts">
        <ConnectorAlertConfig permissionLevel={level} />
      </TabsContent>
    </Tabs>
  );
}
