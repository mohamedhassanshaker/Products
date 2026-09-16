"use client";

/**
 * B10 tab 1 — Channels. The four surfaces (state + bound agent), and the out-of-hours
 * behaviour form: staffed-hours schedule, UAE holiday auto-sync, the 24/7-assistant toggle
 * and the no-agent-available message — plus `offerEscalationOutsideHours`, kept on its own
 * separate control from `assistantAvailable247` per this wave's own rule
 * (`checkHandoverConsistency`), never conflated into one shared "hours" toggle.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Label } from "@/components/ui/label";
import { StatusCell, type StatusFamily } from "@/components/ui/status-cell";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/patterns/data-table/data-table";
import type { ColumnDef } from "@tanstack/react-table";
import type { HandoverHoursSnapshot } from "../../../../modules/channels/application/get-handover-hours.js";
import type { ChannelRow } from "../../../../modules/channels/ports/channel-repository.js";
import type { ChannelKey, ChannelState } from "../../../../modules/channels/domain/vocabulary.js";
import type { AgentOption } from "./composition.js";
import type { ChannelsScreenActions } from "./channels-screen.js";

export interface ChannelsTabProps {
  readonly rows: readonly ChannelRow[];
  readonly handoverHours: HandoverHoursSnapshot | null;
  readonly bindableAgents: readonly AgentOption[];
  readonly actions: ChannelsScreenActions;
}

const STATE_FAMILY: Readonly<Record<ChannelState, StatusFamily>> = {
  Live: "success",
  Disabled: "neutral",
};

/**
 * The two `CHANNEL_KEYS` with a real, citizen-facing implementation in this deployment.
 * `MobileApp`/`KioskIvr` are real, closed-catalogue provisioning targets (kept per
 * `ProvisionDefaultChannelsForTenant` — the enum stays closed at four, `docs/architecture.md`'s
 * own persona/component map only ever names "Assistant widget ... and WhatsApp" as real citizen
 * channels) with no native mobile app and no IVR/telephony integration built or planned in this
 * deployment — no BSP, no app-store listing, no telephony adapter exists for either to bind to.
 * Their row therefore shows an honest "not available" state (below) instead of a live
 * enable/disable toggle that would promise traffic a real citizen could actually reach — the
 * same "surface the real gap, don't dress it up" rule `tools-tab.tsx`'s MCP-discovery and
 * API-connector-testing panels already follow for an analogous "no real backend yet" case.
 */
const LIVE_CAPABLE_CHANNEL_KEYS: ReadonlySet<ChannelKey> = new Set(["WebWidget", "WhatsApp"]);
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function timeToInputValue(time: { readonly hour: number; readonly minute: number }): string {
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

function inputValueToTime(value: string): { readonly hour: number; readonly minute: number } {
  const [hour, minute] = value.split(":").map(Number);
  return { hour: hour || 0, minute: minute || 0 };
}

interface DaySlotState {
  readonly enabled: boolean;
  readonly opensAt: string;
  readonly closesAt: string;
}

function initialSlots(handoverHours: HandoverHoursSnapshot | null): DaySlotState[] {
  return DAY_LABELS.map((label, dayOfWeek) => {
    void label;
    const slot = handoverHours?.workingHoursProfile.slots.find((s) => s.dayOfWeek === dayOfWeek);
    return slot
      ? {
          enabled: true,
          opensAt: timeToInputValue(slot.opensAt),
          closesAt: timeToInputValue(slot.closesAt),
        }
      : { enabled: false, opensAt: "09:00", closesAt: "17:00" };
  });
}

export function ChannelsTab({
  rows,
  handoverHours,
  bindableAgents,
  actions,
}: ChannelsTabProps): React.ReactElement {
  const t = useTranslations("channels.channels");
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const columns = React.useMemo<ColumnDef<ChannelRow, unknown>[]>(
    () => [
      {
        id: "displayName",
        accessorKey: "displayName",
        header: t("columnChannel"),
        meta: { identifying: true },
      },
      {
        id: "boundAgentName",
        accessorFn: (row) => row.boundAgentName ?? "",
        header: t("columnAgent"),
        cell: ({ row }) => row.original.boundAgentName ?? "—",
      },
      {
        id: "availability",
        accessorKey: "availability",
        header: t("columnHours"),
        cell: ({ row }) =>
          row.original.availability === "TwentyFourSeven"
            ? t("twentyFourSeven")
            : t("workingHours"),
      },
      {
        id: "state",
        accessorKey: "state",
        header: t("columnState"),
        cell: ({ row }) => {
          if (!LIVE_CAPABLE_CHANNEL_KEYS.has(row.original.key)) {
            // Honest, non-interactive state — never a toggle that would let an admin flip a
            // channel with no real backing implementation to "Live" (Issue 1, stakeholder
            // review pass). `rank: 2` sorts after both real states if this column is ever
            // made sortable.
            return <StatusCell label={t("stateNotAvailable")} family="neutral" rank={2} />;
          }
          return (
            <button
              type="button"
              onClick={() => void handleToggleState(row.original)}
              className="inline-flex"
              disabled={pending}
            >
              <StatusCell
                label={row.original.state === "Live" ? t("stateLive") : t("stateDisabled")}
                family={STATE_FAMILY[row.original.state]}
                rank={row.original.state === "Live" ? 0 : 1}
              />
            </button>
          );
        },
      },
    ],
    [t, pending],
  );

  async function handleToggleState(row: ChannelRow): Promise<void> {
    setPending(true);
    setError(null);
    const nextState: ChannelState = row.state === "Live" ? "Disabled" : "Live";
    const boundAgentId = row.boundAgentId ?? bindableAgents[0]?.id ?? null;
    if (nextState === "Live" && !boundAgentId) {
      setPending(false);
      setError(t("agentRequiredError"));
      return;
    }
    const result = await actions.updateChannel({ id: row.id, state: nextState, boundAgentId });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.value.ok) {
      setError(t("agentRequiredError"));
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.displayName}
        caption={t("heading")}
        captionVisuallyHidden
      />

      {handoverHours ? (
        <HandoverHoursForm handoverHours={handoverHours} actions={actions} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("handoverHoursMissing")}</p>
      )}
    </div>
  );
}

function HandoverHoursForm({
  handoverHours,
  actions,
}: {
  readonly handoverHours: HandoverHoursSnapshot;
  readonly actions: ChannelsScreenActions;
}): React.ReactElement {
  const t = useTranslations("channels.channels.handoverHours");
  const router = useRouter();
  const [timezone, setTimezone] = React.useState(handoverHours.workingHoursProfile.timezone);
  const [publicHolidayAutoSync, setPublicHolidayAutoSync] = React.useState(
    handoverHours.workingHoursProfile.publicHolidayAutoSync,
  );
  const [assistantAvailable247, setAssistantAvailable247] = React.useState(
    handoverHours.workingHoursProfile.assistantAvailable247,
  );
  const [offerEscalationOutsideHours, setOfferEscalationOutsideHours] = React.useState(
    handoverHours.offerEscalationOutsideHours,
  );
  const [message, setMessage] = React.useState(handoverHours.noAgentAvailableMessage);
  const [slots, setSlots] = React.useState<DaySlotState[]>(() => initialSlots(handoverHours));
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const assistant247Id = React.useId();
  const holidaySyncId = React.useId();
  const offerEscalationId = React.useId();

  async function handleSave(): Promise<void> {
    setPending(true);
    setError(null);
    const result = await actions.updateHandoverHours({
      workingHoursProfileId: handoverHours.workingHoursProfile.id,
      handoverConfigId: handoverHours.handoverConfigId,
      timezone,
      publicHolidayAutoSync,
      assistantAvailable247,
      offerEscalationOutsideHours,
      noAgentAvailableMessage: message,
      slots: slots
        .map((slot, dayOfWeek) => ({ ...slot, dayOfWeek }))
        .filter((slot) => slot.enabled)
        .map((slot) => ({
          dayOfWeek: slot.dayOfWeek,
          opensAt: inputValueToTime(slot.opensAt),
          closesAt: inputValueToTime(slot.closesAt),
        })),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.value.ok) {
      // A literal, explicit key per known reason (never a runtime-interpolated dotted path
      // — `tasks/lessons.md`'s own recorded gotcha about flat keys that merely contain a
      // dot versus a genuinely nested messages object).
      setError(
        result.value.reason === "channels.handover_requires_assistant_available"
          ? t("errors.handoverRequiresAssistantAvailable")
          : result.value.reason,
      );
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border p-4">
      <h2 className="text-sm font-medium text-foreground">{t("heading")}</h2>
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}

      <div className="flex flex-col gap-2">
        {DAY_LABELS.map((label, dayOfWeek) => {
          const slot = slots[dayOfWeek]!;
          return (
            <div key={label} className="flex items-center gap-3">
              <Switch
                checked={slot.enabled}
                onCheckedChange={(checked) =>
                  setSlots((prev) =>
                    prev.map((s, i) => (i === dayOfWeek ? { ...s, enabled: checked } : s)),
                  )
                }
              />
              <span className="w-10 text-sm text-foreground">{label}</span>
              <input
                type="time"
                value={slot.opensAt}
                disabled={!slot.enabled}
                onChange={(event) =>
                  setSlots((prev) =>
                    prev.map((s, i) =>
                      i === dayOfWeek ? { ...s, opensAt: event.target.value } : s,
                    ),
                  )
                }
                className="rounded-xs border border-input bg-background px-2 py-1 text-sm disabled:opacity-50"
              />
              <span className="text-sm text-muted-foreground">–</span>
              <input
                type="time"
                value={slot.closesAt}
                disabled={!slot.enabled}
                onChange={(event) =>
                  setSlots((prev) =>
                    prev.map((s, i) =>
                      i === dayOfWeek ? { ...s, closesAt: event.target.value } : s,
                    ),
                  )
                }
                className="rounded-xs border border-input bg-background px-2 py-1 text-sm disabled:opacity-50"
              />
            </div>
          );
        })}
      </div>

      <FormField label={t("fieldTimezone")}>
        {(field) => (
          <Input
            {...field}
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          />
        )}
      </FormField>

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={holidaySyncId}>{t("fieldPublicHolidayAutoSync")}</Label>
        <Switch
          id={holidaySyncId}
          checked={publicHolidayAutoSync}
          onCheckedChange={setPublicHolidayAutoSync}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={assistant247Id}>{t("fieldAssistantAvailable247")}</Label>
        <Switch
          id={assistant247Id}
          checked={assistantAvailable247}
          onCheckedChange={setAssistantAvailable247}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={offerEscalationId}>{t("fieldOfferEscalationOutsideHours")}</Label>
        <Switch
          id={offerEscalationId}
          checked={offerEscalationOutsideHours}
          onCheckedChange={setOfferEscalationOutsideHours}
        />
      </div>

      <FormField label={t("fieldNoAgentAvailableMessage")}>
        {(field) => (
          <Textarea
            {...field}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
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
