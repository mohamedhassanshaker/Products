"use client";

/**
 * B10 tab 4 — Proactive messaging. `state` (`Blocked`/`On`/`Off`) is rendered exactly as the
 * repository derived it (`deriveCampaignDisplayState`) — never re-derived here, so the badge
 * can never disagree with what `EnableCampaign`'s own real database trigger just decided.
 * Attempting to enable a Blocked campaign calls the real Server Action and surfaces
 * whatever the real `TR_Campaigns_templateMustBeApproved` trigger says, naming the
 * unapproved template — never pre-guessed client-side.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Label } from "@/components/ui/label";
import { StatusCell, type StatusFamily } from "@/components/ui/status-cell";
import { Switch } from "@/components/ui/switch";
import { DataTable } from "@/components/patterns/data-table/data-table";
import type { ColumnDef } from "@tanstack/react-table";
import type { CampaignDisplayState } from "../../../../modules/channels/domain/vocabulary.js";
import type { CampaignRow } from "../../../../modules/channels/ports/campaign-repository.js";
import type { QuietHoursConfigRow } from "../../../../modules/channels/ports/quiet-hours-repository.js";
import type { ChannelsScreenActions } from "./channels-screen.js";

const STATE_FAMILY: Readonly<Record<CampaignDisplayState, StatusFamily>> = {
  On: "success",
  Off: "neutral",
  Blocked: "destructive",
};
const STATE_RANK: Readonly<Record<CampaignDisplayState, number>> = { On: 0, Blocked: 1, Off: 2 };

export interface CampaignsTabProps {
  readonly rows: readonly CampaignRow[];
  readonly quietHours: QuietHoursConfigRow | null;
  /** `agents:publish` — gates "Send now" below (`actions.ts`'s own real permission check:
   *  "pushing an unsolicited message to thousands of citizens is a release action"). Never
   *  rendered for a principal who lacks it, matching `whatsapp-tab.tsx`'s identical fix. */
  readonly canPublish: boolean;
  readonly actions: ChannelsScreenActions;
}

function timeToInputValue(time: { readonly hour: number; readonly minute: number }): string {
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

export function CampaignsTab({
  rows,
  quietHours,
  canPublish,
  actions,
}: CampaignsTabProps): React.ReactElement {
  const t = useTranslations("channels.campaigns");
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  async function handleToggle(row: CampaignRow): Promise<void> {
    setError(null);
    setInfo(null);
    setPendingId(row.id);
    const result = row.isEnabled
      ? await actions.disableCampaign(row.id)
      : await actions.enableCampaign(row.id);
    setPendingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.value.ok) {
      // The trigger's own real refusal, naming the unapproved template — api.md's own
      // requirement ("the failure names the unapproved template").
      setError(
        t("templateNotApprovedError", {
          name: result.value.templateName,
          status: result.value.templateStatus,
        }),
      );
      return;
    }
    router.refresh();
  }

  async function handleSendNow(row: CampaignRow): Promise<void> {
    setError(null);
    setInfo(null);
    setPendingId(row.id);
    const result = await actions.sendCampaignNow(row.id);
    setPendingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.value.ok) {
      setError(
        result.value.reason === "channels.quiet_hours"
          ? t("quietHoursError")
          : t("templateNotApprovedGenericError"),
      );
      return;
    }
    setInfo(
      t("sendNowResult", {
        sent: result.value.sent,
        suppressed: result.value.suppressed,
        throttled: result.value.throttled,
      }),
    );
    router.refresh();
  }

  const columns = React.useMemo<ColumnDef<CampaignRow, unknown>[]>(
    () => [
      { id: "name", accessorKey: "name", header: t("columnCampaign"), meta: { identifying: true } },
      {
        id: "messageTemplateName",
        accessorKey: "messageTemplateName",
        header: t("columnTemplate"),
      },
      {
        id: "trigger",
        accessorKey: "trigger",
        header: t("columnTrigger"),
        cell: ({ row }) => t(`trigger.${row.original.trigger}` as "trigger.Manual"),
      },
      { id: "audienceLabel", accessorKey: "audienceLabel", header: t("columnAudience") },
      {
        id: "sentThisMonth",
        accessorKey: "sentThisMonth",
        header: t("columnSent"),
        meta: { mono: true },
        cell: ({ row }) => t("sentThisMonth", { count: row.original.sentThisMonth }),
      },
      {
        id: "state",
        accessorKey: "state",
        header: t("columnState"),
        cell: ({ row }) =>
          row.original.state === "Blocked" ? (
            <StatusCell
              label={t("stateBlocked")}
              family={STATE_FAMILY.Blocked}
              rank={STATE_RANK.Blocked}
            />
          ) : (
            <div className="flex items-center gap-2">
              <Switch
                checked={row.original.isEnabled}
                disabled={pendingId === row.original.id}
                onCheckedChange={() => void handleToggle(row.original)}
              />
              <StatusCell
                label={row.original.state === "On" ? t("stateOn") : t("stateOff")}
                family={STATE_FAMILY[row.original.state]}
                rank={STATE_RANK[row.original.state]}
              />
            </div>
          ),
        sortingFn: (a, b) => STATE_RANK[a.original.state] - STATE_RANK[b.original.state],
      },
    ],
    [t, pendingId],
  );

  return (
    <div className="flex flex-col gap-6">
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
      {info ? <InlineAlert variant="info">{info}</InlineAlert> : null}

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.name}
        caption={t("heading")}
        captionVisuallyHidden
        renderRowActions={(row) =>
          row.state === "On" && canPublish ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pendingId === row.id}
              onClick={() => void handleSendNow(row)}
            >
              {t("sendNowAction")}
            </Button>
          ) : null
        }
      />

      {quietHours ? <QuietHoursForm quietHours={quietHours} actions={actions} /> : null}
    </div>
  );
}

function QuietHoursForm({
  quietHours,
  actions,
}: {
  readonly quietHours: QuietHoursConfigRow;
  readonly actions: ChannelsScreenActions;
}): React.ReactElement {
  const t = useTranslations("channels.campaigns.quietHours");
  const router = useRouter();
  const [isEnabled, setIsEnabled] = React.useState(quietHours.isEnabled);
  const [startsAt, setStartsAt] = React.useState(timeToInputValue(quietHours.startsAt));
  const [endsAt, setEndsAt] = React.useState(timeToInputValue(quietHours.endsAt));
  const [pending, setPending] = React.useState(false);
  const enabledId = React.useId();

  async function handleSave(): Promise<void> {
    setPending(true);
    const [startHour, startMinute] = startsAt.split(":").map(Number);
    const [endHour, endMinute] = endsAt.split(":").map(Number);
    await actions.updateQuietHours({
      isEnabled,
      startsAt: { hour: startHour || 0, minute: startMinute || 0 },
      endsAt: { hour: endHour || 0, minute: endMinute || 0 },
      timezone: quietHours.timezone,
    });
    setPending(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border p-4">
      <h2 className="text-sm font-medium text-foreground">{t("heading")}</h2>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={enabledId}>{t("fieldEnabled")}</Label>
        <Switch id={enabledId} checked={isEnabled} onCheckedChange={setIsEnabled} />
      </div>
      <FormField label={t("fieldStartsAt")}>
        {(field) => (
          <input
            {...field}
            type="time"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            className="rounded-xs border border-input bg-background px-2 py-1 text-sm"
          />
        )}
      </FormField>
      <FormField label={t("fieldEndsAt")}>
        {(field) => (
          <input
            {...field}
            type="time"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
            className="rounded-xs border border-input bg-background px-2 py-1 text-sm"
          />
        )}
      </FormField>
      <div>
        <Button type="button" loading={pending} onClick={() => void handleSave()}>
          {t("saveAction")}
        </Button>
      </div>
    </div>
  );
}
