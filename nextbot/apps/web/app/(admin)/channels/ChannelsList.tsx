"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { Button, buttonVariants } from "@nextbot/ui/components/ui/button";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { Tooltip, TooltipTrigger, TooltipContent } from "@nextbot/ui/components/ui/tooltip";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@nextbot/ui/components/ui/collapsible";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { StatusBadge, AccessDeniedState, type StatusTone } from "@nextbot/ui";
import { toast } from "@nextbot/ui/lib/toast";
import type { ChannelStatusValue, PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "../../../src/lib/fetch-json";

interface ChannelListItem {
  id: string;
  type: string;
  name: string;
  environment: string;
  status: ChannelStatusValue;
  publicKey: string;
  /** Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.2) — which agent
   *  definition answers on this channel. `null` = unbound, which falls back to the
   *  tenant-wide "most recently promoted Production version" lookup exactly as every
   *  channel behaved before this phase. */
  agentDefinitionId: string | null;
}

interface AgentDefinitionOption {
  id: string;
  name: string;
}

/** Sentinel for the "no binding" option. A `Select` needs a non-empty string value, and
 *  `null` is a real, first-class choice here (not an absence) — unbinding returns the
 *  channel to the tenant-wide fallback, which is a legitimate single-bot configuration. */
const UNBOUND = "__unbound__";

const STATUS_TONE: Record<ChannelStatusValue, StatusTone> = {
  Active: "connected",
  Inactive: "offline",
  Error: "degraded",
};

/** Screen inventory A.3.1's embed snippet, populated with a real tenant slug +
 * channel public key so an admin can copy/paste it directly onto a host page.
 *
 * QA Final Review B3: two independent faults fixed here —
 *  1. `src` used to hardcode `https://cdn.nextbot.io/widget.js`, a nonexistent
 *     host; it now points at wherever *this* deployment's widget-embed static
 *     assets are actually served (`widgetBaseUrl`, from `GET
 *     /api/v1/admin/channels`, itself sourced from `NEXTBOT_WIDGET_BASE_URL`).
 *  2. The path itself is `nextbot.js` under `/loader/`, matching
 *     `apps/widget-embed/nginx.conf`'s real route — not `/widget.js` at the
 *     origin root.
 * The global function name (`NextBot.init(...)`) already matches what
 * `apps/widget-embed/src/loader/nextbot-loader.ts` actually exposes
 * (`window.NextBot = { init }`) — kept as-is. */
function embedSnippet(widgetBaseUrl: string, tenantSlug: string, channelPublicKey: string): string {
  const base = widgetBaseUrl && widgetBaseUrl.endsWith("/") ? widgetBaseUrl.slice(0, -1) : widgetBaseUrl;
  return `<script src="${base}/loader/nextbot.js"></script>\n<script>\n  NextBot.init({\n    tenantId: "${tenantSlug}",\n    channelId: "${channelPublicKey}"\n  });\n</script>`;
}

function EmbedSnippet({
  widgetBaseUrl,
  tenantSlug,
  channel,
}: {
  widgetBaseUrl: string;
  tenantSlug: string;
  channel: ChannelListItem;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={
          <Button size="xs" variant="link">
            {open ? "Hide embed snippet" : "Get embed snippet"}
          </Button>
        }
      />
      <CollapsibleContent>
        <pre className="mt-2 overflow-x-auto rounded-none border bg-muted p-3 text-xs whitespace-pre">
          {embedSnippet(widgetBaseUrl, tenantSlug, channel.publicKey)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Channels admin screen (BL-04 prerequisite): lists channels and lets an admin
 * create a `WebWidget` channel + copy its embed snippet. Deliberately scoped to
 * WebWidget only — the full FR-OC-02 multi-channel-type list (WhatsApp/Voice/etc.
 * with 24h volume) and FR-OC-03 per-type setup wizards are a later backlog phase
 * (BL-14/BL-15); this exists so BL-04's widget has a real channel to embed.
 */
export function ChannelsList({ permissionLevel }: { permissionLevel: PermissionLevelValue }) {
  const [channels, setChannels] = useState<ChannelListItem[] | null>(null);
  const [tenantSlug, setTenantSlug] = useState("");
  const [widgetBaseUrl, setWidgetBaseUrl] = useState("");
  const [forbidden, setForbidden] = useState(false);
  /** Phase 17 (BL-48): `null` while loading, `[]` when this admin has no
   *  `agent_platform` Read permission — in which case the "Answered by" column renders
   *  read-only rather than an empty, un-actionable picker. */
  const [definitions, setDefinitions] = useState<AgentDefinitionOption[] | null>(null);
  const canWrite = permissionLevel === "Write";

  useEffect(() => {
    void (async () => {
      const result = await fetchJson<{ channels: ChannelListItem[]; tenantSlug: string; widgetBaseUrl: string }>(
        "/api/v1/admin/channels",
      );
      if (result.kind === "forbidden") {
        setForbidden(true);
        return;
      }
      if (result.kind === "ok") {
        setChannels(result.data.channels ?? []);
        setTenantSlug(result.data.tenantSlug);
        setWidgetBaseUrl(result.data.widgetBaseUrl);
      }
    })();
    void (async () => {
      // A separate RBAC module (`agent_platform`) — an admin with Channels access but no
      // Agent Platform access legitimately gets a 403 here, which is not an error for
      // this screen.
      const result = await fetchJson<{ definitions: AgentDefinitionOption[] }>("/api/v1/admin/agent-platform/definitions");
      setDefinitions(result.kind === "ok" ? result.data.definitions : []);
    })();
  }, []);

  /** Phase 17 (BL-48, ADR-0019 §2.2) — sets or clears a channel's agent-definition
   *  binding. Optimistically updates the row, then reconciles from the server response;
   *  on failure the row is reverted so the UI never claims a binding the server rejected. */
  async function setBinding(channelId: string, next: string) {
    const agentDefinitionId = next === UNBOUND ? null : next;
    const previous = channels?.find((c) => c.id === channelId)?.agentDefinitionId ?? null;
    setChannels((current) => (current ?? []).map((c) => (c.id === channelId ? { ...c, agentDefinitionId } : c)));
    const result = await fetchJson(`/api/v1/admin/channels/${channelId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentDefinitionId }),
    });
    if (result.kind !== "ok") {
      setChannels((current) => (current ?? []).map((c) => (c.id === channelId ? { ...c, agentDefinitionId: previous } : c)));
      toast.error(result.message);
      return;
    }
    toast.success(agentDefinitionId ? "Channel binding updated." : "Channel unbound — it now uses this tenant's most recently promoted Production version.");
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Channels" />;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">Channels</h1>
        {canWrite ? (
          <NextLink href="/channels/new" className={buttonVariants()}>
            + Add Channel
          </NextLink>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <span tabIndex={0} className="inline-block">
                  <Button disabled aria-disabled="true">
                    + Add Channel
                  </Button>
                </span>
              }
            />
            <TooltipContent>You have read-only access to this module</TooltipContent>
          </Tooltip>
        )}
      </div>
      {!channels ? (
        <Skeleton className="h-32 w-full" role="status" aria-label="Loading channels" />
      ) : channels.length === 0 ? (
        <p className="text-muted-foreground">No channels yet — add a Web Widget channel to embed NextBot on your site.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Environment</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Answered by</TableHead>
              <TableHead>Embed</TableHead>
              <TableHead>Test</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {channels.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.name}</TableCell>
                <TableCell>{c.type}</TableCell>
                <TableCell>{c.environment}</TableCell>
                <TableCell>
                  <StatusBadge tone={STATUS_TONE[c.status]} label={c.status} />
                </TableCell>
                {/* Phase 17 (BL-48, ADR-0019 §2.2) — which BOT answers here. Which BUILD
                    of that bot serves a given conversation is the deployment traffic
                    split's job, edited on the agent definition's own Deployments & Canary
                    tab, not here. */}
                <TableCell>
                  {!definitions || definitions.length === 0 || !canWrite ? (
                    <span className="text-sm text-muted-foreground">
                      {c.agentDefinitionId ? (definitions?.find((d) => d.id === c.agentDefinitionId)?.name ?? "Bound") : "Tenant default"}
                    </span>
                  ) : (
                    <Select value={c.agentDefinitionId ?? UNBOUND} onValueChange={(v) => v !== null && void setBinding(c.id, v)}>
                      <SelectTrigger className="w-[220px]" aria-label={`Agent definition answering on ${c.name}`}>
                        <SelectValue placeholder="Tenant default" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNBOUND}>Tenant default (no binding)</SelectItem>
                        {definitions.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
                <TableCell>
                  {c.type === "WebWidget" ? (
                    <EmbedSnippet widgetBaseUrl={widgetBaseUrl} tenantSlug={tenantSlug} channel={c} />
                  ) : c.type === "WhatsApp" ? (
                    <NextLink href={`/channels/${c.id}/whatsapp`} className={buttonVariants({ size: "xs", variant: "link" })}>
                      Configure
                    </NextLink>
                  ) : null}
                </TableCell>
                <TableCell>
                  {c.type === "WebWidget" ? (
                    <NextLink href={`/channels/${c.id}/test`} className={buttonVariants({ size: "xs", variant: "outline" })}>
                      Test this channel
                    </NextLink>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
