"use client";

/**
 * B3 step 4 — Skills & tools. Three sub-tabs (Skills catalogue / MCP servers / API
 * connectors), each reading the same shared catalogue `/tools` (B5) reads, and writing
 * through the exact same `BindTool`/`UnbindTool` use cases `/tools` would call if it ever
 * grew a bind control — this is what "shared tool registry: binding in the wizard and in B5
 * are the same data" actually means (`tasks/todo.md`'s own resolved judgment call: the
 * *data path* is shared; the bind/unbind *control* is wizard-only, matching `api.md` §6.5's
 * "counts, not a toggle" for B5's own reads).
 *
 * "Registered ≠ callable": every skill/tool/connector below is already registered in the
 * platform catalogue — binding here is what makes one *callable by this agent version*.
 *
 * ## The empty-catalogue dead end this file fixes
 *
 * When a tenant's catalogue for one of the three sub-tabs is genuinely empty (confirmed live:
 * `sharjah`/`customs`/`libraries` all had zero skills/MCP servers/API connectors before this
 * wave's own tenant-provisioning fix), this step used to render a bare, guidance-free empty
 * table — indistinguishable from "there is no way to add anything here." Creation
 * deliberately does NOT live in this wizard (it lives on the separate `/tools` registry
 * screen, per this file's own module comment above on why the data path is shared but the
 * bind/unbind control is wizard-only) — so each sub-tab now renders a real `EmptyState`
 * pointing the admin at `/tools` instead, rather than duplicating a creation form here.
 */

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { StatusCell } from "@/components/ui/status-cell";
import { SummaryStrip } from "@/components/ui/summary-strip";
import { SubTabBar, SubTabBarPanel } from "@/components/ui/sub-tab-bar";
import { DataTable } from "@/components/patterns/data-table/data-table";
import type { ColumnDef } from "@tanstack/react-table";
import type { SkillCatalogRow } from "../../../../../../../modules/tools/application/list-skills.js";
import type {
  McpServerRow,
  McpToolRow,
} from "../../../../../../../modules/tools/ports/mcp-server-repository.js";
import type { ApiConnectorCatalogRow } from "../../../../../../../modules/tools/application/list-api-connectors.js";
import type { ToolBindingRow } from "../../../../../../../modules/tools/ports/tool-binding-repository.js";
import type { ToolBindingTargetKind } from "../../../../../../../modules/tools/domain/tool-catalog.js";
import type {
  bindToolAction,
  connectAndDiscoverMcpServerAction,
  unbindToolAction,
} from "../../../actions.js";

export interface ToolsStepProps {
  readonly agentVersionId: string;
  readonly skills: readonly SkillCatalogRow[];
  readonly mcpServers: readonly McpServerRow[];
  readonly mcpToolsByServer: Readonly<Record<string, readonly McpToolRow[]>>;
  readonly apiConnectors: readonly ApiConnectorCatalogRow[];
  readonly initialBindings: readonly ToolBindingRow[];
  readonly bindTool: typeof bindToolAction;
  readonly unbindTool: typeof unbindToolAction;
  readonly connectAndDiscoverMcpServer: typeof connectAndDiscoverMcpServerAction;
  readonly onBindingsChange: (hasAny: boolean) => void;
}

function bindingKey(targetKind: ToolBindingTargetKind, targetId: string): string {
  return `${targetKind}:${targetId}`;
}

/** `ToolBindingRow` stores the target as three mutually-exclusive nullable FK columns (`skillId`/`mcpToolId`/`apiConnectorId`), not one generic `targetId` — this recovers the one that `targetKind` says is populated. */
function targetIdOf(binding: ToolBindingRow): string {
  const id =
    binding.targetKind === "Skill"
      ? binding.skillId
      : binding.targetKind === "McpTool"
        ? binding.mcpToolId
        : binding.apiConnectorId;
  if (id === null) {
    throw new Error(
      `ToolBinding "${binding.id}" has targetKind "${binding.targetKind}" but a null matching id.`,
    );
  }
  return id;
}

export function ToolsStep({
  agentVersionId,
  skills,
  mcpServers,
  mcpToolsByServer,
  apiConnectors,
  initialBindings,
  bindTool,
  unbindTool,
  connectAndDiscoverMcpServer,
  onBindingsChange,
}: ToolsStepProps): React.ReactElement {
  const t = useTranslations("agents.wizard.tools");
  const locale = useLocale();
  const router = useRouter();
  const goToToolRegistry = React.useCallback(() => {
    router.push(`/${locale}/tools`);
  }, [router, locale]);
  const [bound, setBound] = React.useState<ReadonlySet<string>>(
    new Set(
      initialBindings
        .filter((b) => b.isEnabled)
        .map((b) => bindingKey(b.targetKind, targetIdOf(b))),
    ),
  );
  const [pendingKey, setPendingKey] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [discoveryState, setDiscoveryState] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    onBindingsChange(bound.size > 0);
    // Deliberately only depends on `bound.size`, not `bound` itself or `onBindingsChange`:
    // the parent only needs to know "has at least one binding", not the exact set, and
    // `onBindingsChange` is a fresh closure every render — this project's lint config has
    // no react-hooks/exhaustive-deps rule registered, so no suppression comment is needed.
  }, [bound.size]);

  async function toggle(
    targetKind: ToolBindingTargetKind,
    targetId: string,
    nextEnabled: boolean,
  ): Promise<void> {
    const key = bindingKey(targetKind, targetId);
    setPendingKey(key);
    setError(null);
    if (nextEnabled) {
      const result = await bindTool({
        agentVersionId,
        targetKind,
        targetId,
        requiredAssurance: "Anonymous",
      });
      setPendingKey(null);
      if (!result.ok) {
        setError(t(`reason.${result.reason}`, { defaultValue: result.reason }));
        return;
      }
      setBound((current) => new Set(current).add(key));
    } else {
      const result = await unbindTool({ agentVersionId, targetKind, targetId });
      setPendingKey(null);
      if (!result.ok) {
        setError(t(`reason.${result.reason}`, { defaultValue: result.reason }));
        return;
      }
      setBound((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  async function discover(serverId: string): Promise<void> {
    setDiscoveryState((s) => ({ ...s, [serverId]: "loading" }));
    const result = await connectAndDiscoverMcpServer(serverId);
    setDiscoveryState((s) => ({ ...s, [serverId]: result.ok ? "ok" : result.reason }));
  }

  const skillColumns = React.useMemo<ColumnDef<SkillCatalogRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: t("skills.columnName"),
        meta: { identifying: true },
      },
      {
        id: "invocationKind",
        accessorKey: "invocationKind",
        header: t("skills.columnKind"),
        cell: ({ row }) => t(`skills.kind.${row.original.invocationKind}`),
      },
      {
        id: "bound",
        header: t("skills.columnBound"),
        cell: ({ row }) => {
          const key = bindingKey("Skill", row.original.id);
          return (
            <Button
              type="button"
              size="sm"
              variant={bound.has(key) ? "outline" : "primary"}
              loading={pendingKey === key}
              onClick={() => void toggle("Skill", row.original.id, !bound.has(key))}
            >
              {bound.has(key) ? t("detachAction") : t("attachAction")}
            </Button>
          );
        },
      },
    ],
    [t, bound, pendingKey],
  );

  const connectorColumns = React.useMemo<ColumnDef<ApiConnectorCatalogRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: t("connectors.columnName"),
        meta: { identifying: true },
      },
      {
        id: "method",
        accessorKey: "method",
        header: t("connectors.columnMethod"),
        meta: { mono: true },
      },
      {
        id: "urlTemplate",
        accessorKey: "urlTemplate",
        header: t("connectors.columnEndpoint"),
        meta: { mono: true },
      },
      {
        id: "testState",
        accessorKey: "testState",
        header: t("connectors.columnState"),
        cell: ({ row }) => (
          <StatusCell
            label={t(`connectors.testState.${row.original.testState}`)}
            family={row.original.testState === "Tested" ? "success" : "info"}
            rank={row.original.testState === "Tested" ? 0 : 1}
          />
        ),
      },
      {
        id: "bound",
        header: t("connectors.columnBound"),
        cell: ({ row }) => {
          const key = bindingKey("ApiConnector", row.original.id);
          return (
            <Button
              type="button"
              size="sm"
              variant={bound.has(key) ? "outline" : "primary"}
              loading={pendingKey === key}
              onClick={() => void toggle("ApiConnector", row.original.id, !bound.has(key))}
            >
              {bound.has(key) ? t("detachAction") : t("attachAction")}
            </Button>
          );
        },
      },
    ],
    [t, bound, pendingKey],
  );

  return (
    <div className="flex flex-col gap-4">
      <SummaryStrip variant="rule">{t("registeredNotCallableRule")}</SummaryStrip>
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
      <SubTabBar
        tabs={[
          { value: "skills", label: t("subTabSkills") },
          { value: "mcp", label: t("subTabMcp") },
          { value: "connectors", label: t("subTabConnectors") },
        ]}
        variant="nested"
        aria-label={t("subTabsAriaLabel")}
        urlParam={null}
        defaultValue="skills"
      >
        <SubTabBarPanel value="skills">
          {skills.length === 0 ? (
            <EmptyState
              headline={t("skills.emptyHeadline")}
              cause={t("skills.emptyCause")}
              action={{ label: t("goToRegistryAction"), onClick: goToToolRegistry }}
            />
          ) : (
            <DataTable
              columns={skillColumns}
              data={skills}
              getRowId={(row) => row.id}
              getRowLabel={(row) => row.name}
              caption={t("subTabSkills")}
              captionVisuallyHidden
            />
          )}
        </SubTabBarPanel>
        <SubTabBarPanel value="mcp">
          {mcpServers.length === 0 ? (
            <EmptyState
              headline={t("mcp.emptyHeadline")}
              cause={t("mcp.emptyCause")}
              action={{ label: t("goToRegistryAction"), onClick: goToToolRegistry }}
            />
          ) : (
            <ul className="flex flex-col gap-4">
              {mcpServers.map((server) => (
                <li key={server.id} className="flex flex-col gap-2 border-b border-border pb-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-foreground">{server.name}</span>
                      <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                        {server.endpoint}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusCell
                        label={t(`mcp.connectionState.${server.connectionState}`)}
                        family={server.connectionState === "Connected" ? "success" : "info"}
                        rank={server.connectionState === "Connected" ? 0 : 1}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        loading={discoveryState[server.id] === "loading"}
                        onClick={() => void discover(server.id)}
                      >
                        {t("mcp.connectAndDiscoverAction")}
                      </Button>
                    </div>
                  </div>
                  {(() => {
                    const state = discoveryState[server.id];
                    if (!state || state === "loading" || state === "ok") return null;
                    return (
                      <InlineAlert variant="destructive">
                        {t(`mcp.discoveryError.${state}`, { defaultValue: state })}
                      </InlineAlert>
                    );
                  })()}
                  <div className="flex flex-wrap gap-2">
                    {(mcpToolsByServer[server.id] ?? []).map((tool) => {
                      const key = bindingKey("McpTool", tool.id);
                      return (
                        <Button
                          key={tool.id}
                          type="button"
                          size="sm"
                          variant={bound.has(key) ? "outline" : "primary"}
                          loading={pendingKey === key}
                          onClick={() => void toggle("McpTool", tool.id, !bound.has(key))}
                        >
                          {tool.name}
                          {bound.has(key) ? ` ✓` : ""}
                        </Button>
                      );
                    })}
                    {(mcpToolsByServer[server.id] ?? []).length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {t("mcp.noToolsDiscovered")}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SubTabBarPanel>
        <SubTabBarPanel value="connectors">
          {apiConnectors.length === 0 ? (
            <EmptyState
              headline={t("connectors.emptyHeadline")}
              cause={t("connectors.emptyCause")}
              action={{ label: t("goToRegistryAction"), onClick: goToToolRegistry }}
            />
          ) : (
            <DataTable
              columns={connectorColumns}
              data={apiConnectors}
              getRowId={(row) => row.id}
              getRowLabel={(row) => row.name}
              caption={t("subTabConnectors")}
              captionVisuallyHidden
            />
          )}
        </SubTabBarPanel>
      </SubTabBar>
    </div>
  );
}
