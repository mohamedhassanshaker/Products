import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import { PermissionDeniedError } from "../../../../modules/iam/domain/permissions.js";
import { ListApiConnectors } from "../../../../modules/tools/application/list-api-connectors.js";
import { ListCircuitBreakers } from "../../../../modules/tools/application/list-circuit-breakers.js";
import { ListMcpServers } from "../../../../modules/tools/application/list-mcp-servers.js";
import { ListSkills } from "../../../../modules/tools/application/list-skills.js";
import type { ApiConnectorCatalogRow } from "../../../../modules/tools/application/list-api-connectors.js";
import type { CircuitBreakerCatalogRow } from "../../../../modules/tools/application/list-circuit-breakers.js";
import type { SkillCatalogRow } from "../../../../modules/tools/application/list-skills.js";
import {
  apiConnectorRepository,
  circuitBreakerRepository,
  circuitBreakerStateStore,
  mcpServerRepository,
  skillRepository,
  toolBindingRepository,
} from "./composition.js";
import { ToolsScreen, type McpServerWithTools } from "./tools-screen.js";
import {
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

type PageData =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | {
      readonly kind: "ok";
      readonly skills: readonly SkillCatalogRow[];
      readonly mcpServers: readonly McpServerWithTools[];
      readonly apiConnectors: readonly ApiConnectorCatalogRow[];
      readonly circuitBreakers: readonly CircuitBreakerCatalogRow[];
    };

/**
 * `/tools` (B5: Tools & MCP registry) — the platform-wide tool estate: skills, MCP servers,
 * API connectors, and the circuit breakers that keep a slow dependency from stalling every
 * conversation touching it.
 *
 * ## Gated on `agents:manage`, and only that
 *
 * There is no `tools:*` permission key in `modules/iam/domain/permissions.ts` — B5 is the
 * estate-wide view of the same catalogue the agent wizard's step 4 reads, so it gates on the
 * same permission that screen does. `agents:publish` is not required: an Agent Designer
 * registering a connector or resetting a breaker is not releasing anything to citizens.
 *
 * ## Read-only here; the bind action lives in the agent wizard, deliberately
 *
 * Tabs 1 and 3 show `boundAgentVersionCount` and tab 2 shows a per-tool binding count as plain
 * numbers, with nothing to click. That is not an omission: attaching a tool to a *specific*
 * agent version is a per-agent decision (`api.md` §6.5's own `GET /tools/skills` returns
 * attachment **counts**, not a toggle), so the single bind/unbind surface is wizard step 4.
 * Both routes call the same `modules/tools` use cases against the same tables, which is what
 * makes "binding in either location is reflected in the other" true — one shared data path,
 * not a second, competing UI control.
 *
 * ## Every query runs inside `withStaffAuth`'s handler, never after it returns
 *
 * `getTenantDb()`/`getTenantCache()` resolve from an ambient `TenantContext` that exists only
 * for the duration of `withStaffAuth`'s callback (see `next-request-context.ts`). So every use
 * case call happens *inside* the handler, and what crosses back out is the resolved `PageData`
 * — plain rows, no live repository handles. Getting that ordering wrong is exactly what would
 * make this page throw `MissingTenantContextError` on every real request. Identical to
 * `iam/page.tsx`, for identical reasons.
 */
export default async function ToolsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("tools");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      try {
        requirePermission(principal, "agents:manage", "tools.page (visibility)");
      } catch (error) {
        if (error instanceof PermissionDeniedError) return { kind: "forbidden" } as const;
        throw error;
      }

      const servers = mcpServerRepository();
      const [skillsResult, serversResult, connectorsResult, breakersResult, mcpToolCounts] =
        await Promise.all([
          new ListSkills({
            skills: skillRepository(),
            bindings: toolBindingRepository(),
          }).execute(),
          new ListMcpServers({ servers }).execute(),
          new ListApiConnectors({
            connectors: apiConnectorRepository(),
            bindings: toolBindingRepository(),
          }).execute(),
          new ListCircuitBreakers({
            breakers: circuitBreakerRepository(),
            state: circuitBreakerStateStore(),
          }).execute(),
          toolBindingRepository().countEnabledBindingsByMcpTool(),
        ]);

      // Each server's already-discovered tools, read alongside the server rows so tab 2 can
      // show them without a second round trip per row — `ListMcpServers` returns servers only,
      // and a tool list is per-server by nature (`McpToolRow.mcpServerId`).
      const mcpServers: readonly McpServerWithTools[] = await Promise.all(
        serversResult.rows.map(async (server): Promise<McpServerWithTools> => {
          const tools = await servers.listTools(server.id);
          return {
            server,
            tools: tools.map((tool) => ({
              ...tool,
              boundAgentVersionCount: mcpToolCounts.get(tool.id) ?? 0,
            })),
          };
        }),
      );

      return {
        kind: "ok",
        skills: skillsResult.rows,
        mcpServers,
        apiConnectors: connectorsResult.rows,
        circuitBreakers: breakersResult.rows,
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
          signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/tools`)}`}
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
      <ToolsScreen
        skills={pageData.skills}
        mcpServers={pageData.mcpServers}
        apiConnectors={pageData.apiConnectors}
        circuitBreakers={pageData.circuitBreakers}
        actions={{
          createNativeSkill: createNativeSkillAction,
          updateSkill: updateSkillAction,
          deleteSkill: deleteSkillAction,
          createMcpServer: createMcpServerAction,
          updateMcpServer: updateMcpServerAction,
          deleteMcpServer: deleteMcpServerAction,
          connectAndDiscoverMcpServer: connectAndDiscoverMcpServerAction,
          createApiConnector: createApiConnectorAction,
          updateApiConnector: updateApiConnectorAction,
          deleteApiConnector: deleteApiConnectorAction,
          testApiConnector: testApiConnectorAction,
          updateCircuitBreakerConfig: updateCircuitBreakerConfigAction,
          resetCircuitBreaker: resetCircuitBreakerAction,
          tripCircuitBreaker: tripCircuitBreakerAction,
        }}
      />
    </div>
  );
}
