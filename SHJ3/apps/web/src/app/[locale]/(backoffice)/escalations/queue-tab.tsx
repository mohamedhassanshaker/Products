"use client";

/**
 * B8's escalation queue + per-ticket workspace. A live agent's own tab
 * (`escalations:handle`).
 *
 * ## Canned replies populate the composer, they never send
 *
 * `handleCannedReplySelect` below does exactly one thing: `setComposerValue(reply.body)`.
 * It never calls `actions.sendAgentMessage`. The only path that sends is
 * `handleSend`, wired to `Composer`'s own `onSend` — the same button/Enter-key path a
 * hand-typed message takes. `queue-tab.test.tsx` proves this distinction directly:
 * selecting a canned reply populates the field and asserts the send action was never
 * called, then a separate, explicit send asserts it was.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { StatusCell, type StatusFamily } from "@/components/ui/status-cell";
import { DataTable } from "@/components/patterns/data-table/data-table";
import { ChatThread } from "@/components/patterns/chat-thread/chat-thread";
import { Composer } from "@/components/patterns/composer/composer";
import type { ChatTurn } from "@/components/patterns/chat-thread/chat-thread-types";
import type { ColumnDef } from "@tanstack/react-table";
import type { PresenceStatus } from "../../../../modules/escalation/domain/presence.js";
import type { AgentPresenceRow } from "../../../../modules/escalation/ports/agent-presence-repository.js";
import type { EscalationTicketSummary } from "../../../../modules/escalation/ports/ticket-repository.js";
import type { TicketDetailActionResult } from "./actions.js";
import type { EscalationsScreenActions } from "./escalations-screen.js";

type QueueRow = EscalationTicketSummary & { readonly waitTimeMinutes: number };

const PRIORITY_FAMILY: Readonly<Record<string, StatusFamily>> = {
  High: "warning",
  Normal: "neutral",
};
const PRIORITY_RANK: Readonly<Record<string, number>> = { High: 0, Normal: 1 };
const PRESENCE_FAMILY: Readonly<Record<PresenceStatus, StatusFamily>> = {
  Available: "success",
  Busy: "warning",
  Offline: "neutral",
};
const PRESENCE_RANK: Readonly<Record<PresenceStatus, number>> = {
  Available: 0,
  Busy: 1,
  Offline: 2,
};

function turnRoleFor(role: string): ChatTurn["role"] {
  // HumanAgent renders on the "assistant" side of the thread — the non-citizen
  // party — a real, named UI simplification: this component has no third bubble
  // style of its own yet for a live agent's own messages.
  if (role === "Citizen") return "user";
  if (role === "System") return "system";
  return "assistant";
}

export interface QueueTabProps {
  readonly initialQueue: readonly QueueRow[];
  readonly initialPresence: AgentPresenceRow | null;
  readonly localeCode: string;
  readonly actions: EscalationsScreenActions;
}

export function QueueTab({
  initialQueue,
  initialPresence,
  localeCode,
  actions,
}: QueueTabProps): React.ReactElement {
  const t = useTranslations("escalations.queue");
  const router = useRouter();

  const [queue, setQueue] = React.useState(initialQueue);
  const [presence, setPresence] = React.useState(initialPresence);
  const [selectedTicketId, setSelectedTicketId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<TicketDetailActionResult | null>(null);
  const [composerValue, setComposerValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => setQueue(initialQueue), [initialQueue]);
  React.useEffect(() => setPresence(initialPresence), [initialPresence]);

  const refreshDetail = React.useCallback(
    async (ticketId: string) => {
      const result = await actions.getTicketDetail(ticketId, localeCode);
      if (result.ok) setDetail(result.value);
      else setError(result.error);
    },
    [actions, localeCode],
  );

  async function handlePresenceChange(status: PresenceStatus): Promise<void> {
    setError(null);
    const result = await actions.setAgentPresence(status);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPresence(result.value);
    router.refresh();
  }

  const handleSelect = React.useCallback(
    async (row: QueueRow): Promise<void> => {
      setError(null);
      setSelectedTicketId(row.id);
      setComposerValue("");

      if (row.status === "Queued") {
        setBusy(true);
        const claimed = await actions.claimTicket(row.id);
        setBusy(false);
        if (!claimed.ok) {
          setError(claimed.error);
          setSelectedTicketId(null);
          return;
        }
        router.refresh();
      }
      await refreshDetail(row.id);
    },
    [actions, refreshDetail, router],
  );

  /** Populates the composer. Never sends — see this file's own module comment. */
  function handleCannedReplySelect(body: string): void {
    setComposerValue(body);
  }

  async function handleSend(): Promise<void> {
    if (!selectedTicketId || composerValue.trim().length === 0) return;
    setError(null);
    setBusy(true);
    const result = await actions.sendAgentMessage(selectedTicketId, composerValue.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setComposerValue("");
    await refreshDetail(selectedTicketId);
  }

  async function handleResolve(outcome: "resolved" | "abandoned"): Promise<void> {
    if (!selectedTicketId) return;
    setError(null);
    setBusy(true);
    const result = await actions.resolveTicket(selectedTicketId, outcome);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSelectedTicketId(null);
    setDetail(null);
    router.refresh();
  }

  async function handleRelease(): Promise<void> {
    if (!selectedTicketId) return;
    setError(null);
    setBusy(true);
    const result = await actions.releaseTicket(selectedTicketId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSelectedTicketId(null);
    setDetail(null);
    router.refresh();
  }

  const columns = React.useMemo<ColumnDef<QueueRow, unknown>[]>(
    () => [
      {
        id: "topic",
        accessorKey: "topic",
        header: t("columnTopic"),
        meta: { identifying: true },
        cell: ({ row }) => (
          <Button variant="link" size="sm" onClick={() => void handleSelect(row.original)}>
            {row.original.topic}
          </Button>
        ),
      },
      { id: "channelKey", accessorKey: "channelKey", header: t("columnChannel") },
      {
        id: "waitTimeMinutes",
        accessorKey: "waitTimeMinutes",
        header: t("columnWaiting"),
        cell: ({ row }) => t("minutesAgo", { minutes: row.original.waitTimeMinutes }),
      },
      {
        id: "priority",
        accessorKey: "priority",
        header: t("columnPriority"),
        cell: ({ row }) => (
          <StatusCell
            family={PRIORITY_FAMILY[row.original.priority] ?? "neutral"}
            label={row.original.priority}
            rank={PRIORITY_RANK[row.original.priority] ?? 99}
          />
        ),
      },
      { id: "status", accessorKey: "status", header: t("columnStatus") },
    ],
    [t, handleSelect],
  );

  const chatTurns: ChatTurn[] = detail
    ? detail.transcript.map((turn) => {
        const role = turnRoleFor(turn.role);
        if (role === "system")
          return { id: turn.id, timestamp: turn.createdAt, role, note: turn.contentMasked };
        if (role === "user")
          return { id: turn.id, timestamp: turn.createdAt, role, text: turn.contentMasked };
        return { id: turn.id, timestamp: turn.createdAt, role, text: turn.contentMasked };
      })
    : [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <Card className="flex items-center justify-between gap-3 p-4">
          <span className="text-sm font-medium text-foreground">{t("agentStatusLabel")}</span>
          <div className="flex gap-2">
            {(["Available", "Busy", "Offline"] as const).map((status) => (
              <Button
                key={status}
                type="button"
                size="sm"
                variant={presence?.status === status ? "primary" : "outline"}
                onClick={() => void handlePresenceChange(status)}
              >
                <StatusCell
                  family={PRESENCE_FAMILY[status]}
                  label={t(`presence.${status}`)}
                  rank={PRESENCE_RANK[status]}
                />
              </Button>
            ))}
          </div>
        </Card>

        {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}

        <DataTable<QueueRow>
          columns={columns}
          data={queue}
          getRowId={(row) => row.id}
          caption={t("queueCaption")}
          status={queue.length === 0 ? "empty" : "ready"}
          emptyContent={<EmptyState headline={t("emptyHeadline")} cause={t("emptyCause")} />}
        />
      </div>

      <div>
        {!selectedTicketId || !detail ? (
          <Card className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
            {t("selectAPrompt")}
          </Card>
        ) : (
          <Card className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Badge label={detail.ticket.topic} />
                <Badge
                  variant="outline"
                  label={t(`reason.${detail.ticket.reason}` as "reason.UserRequest")}
                />
              </div>
              <p className="text-sm text-muted-foreground">{detail.reasonLabel}</p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="font-medium text-foreground">{t("customerLabel")}</p>
                <p className="text-muted-foreground">
                  {detail.identity
                    ? t("verifiedVia", {
                        name: detail.identity.displayNameMasked ?? t("unknownCitizen"),
                        provider:
                          detail.identity.verifiedByProviderKey ?? detail.identity.assuranceLevel,
                      })
                    : t("notVerified")}
                </p>
              </div>
              {detail.ticket.pendingSlotName ? (
                <div>
                  <p className="font-medium text-foreground">{t("pendingSlotLabel")}</p>
                  <p className="text-muted-foreground">{detail.ticket.pendingSlotName}</p>
                </div>
              ) : null}
            </div>

            <ChatThread
              turns={chatTurns}
              variant="handover"
              aria-label={t("transcriptAriaLabel")}
            />

            {detail.cannedReplies.length > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-foreground">{t("cannedRepliesLabel")}</p>
                <div className="flex flex-wrap gap-2">
                  {detail.cannedReplies.map((reply) => (
                    <Button
                      key={reply.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleCannedReplySelect(reply.body)}
                    >
                      {reply.name}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            <Composer
              value={composerValue}
              onValueChange={setComposerValue}
              onSend={() => void handleSend()}
              status={busy ? { type: "sending" } : { type: "idle" }}
              placeholder={t("composerPlaceholder")}
            />

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleRelease()}
                disabled={busy}
              >
                {t("releaseAction")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleResolve("abandoned")}
                disabled={busy}
              >
                {t("abandonAction")}
              </Button>
              <Button type="button" onClick={() => void handleResolve("resolved")} disabled={busy}>
                {t("resolveAction")}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
