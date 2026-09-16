"use client";

/**
 * B5 tab 4 — Resilience & fallbacks. A real `DataTable` (design-system.md §5.5 #41).
 *
 * ## Config and live state are two different things, and this tab keeps them apart
 *
 * A row's thresholds, cooldown, fallback strategy and degraded-mode message are SQL config
 * (`CircuitBreakerConfig`); its `Open`/`HalfOpen`/`Closed` state is Redis, shared across every
 * web replica so one replica's trip is every replica's trip. `UpdateCircuitBreakerConfig`
 * deliberately never touches live state, and `ResetCircuitBreaker`/`TripCircuitBreaker` never
 * touch config — so this tab edits configuration in a dialog and changes state through two
 * separate, explicitly attributed row actions.
 *
 * ## Both state actions are attributed to the real signed-in person
 *
 * `actorStaffUserId` comes from `withStaffAuth`'s own principal inside the Server Action, never
 * from anything this component could invent, and the manual-trip `reason` is typed by the
 * operator. A manual change to a shared dependency's breaker is exactly the kind of act that
 * has to be traceable to a person who chose to make it.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Label } from "@/components/ui/label";
import { MonoSubLine } from "@/components/ui/mono-sub-line";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusCell, type StatusFamily } from "@/components/ui/status-cell";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/patterns/data-table/data-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/patterns/dialog";
import type { CircuitBreakerCatalogRow } from "../../../../modules/tools/application/list-circuit-breakers.js";
import {
  FALLBACK_STRATEGIES,
  type BreakerTransition,
  type CircuitBreakerTargetKind,
  type FallbackStrategy,
} from "../../../../modules/tools/domain/circuit-breaker.js";
import type { ToolsScreenActions } from "./tools-screen.js";

export interface CircuitBreakersTabProps {
  readonly rows: readonly CircuitBreakerCatalogRow[];
  /** Target id → the target's own display name, so a row-scoped breaker reads as "Fetch SEWA bill" rather than a ULID. Built by `ToolsScreen` from the connector and MCP-server rows it already has. */
  readonly targetNames: Readonly<Record<string, string>>;
  readonly actions: ToolsScreenActions;
}

/**
 * Sort rank (§5.4 #39 — never alphabetical). `Open` first: an open breaker means citizens are
 * being served a fallback right now, which is the whole reason to open this tab.
 */
const STATE_RANK: Readonly<Record<BreakerTransition, number>> = {
  Open: 0,
  HalfOpen: 1,
  Closed: 2,
};

const STATE_FAMILY: Readonly<Record<BreakerTransition, StatusFamily>> = {
  Open: "destructive",
  HalfOpen: "warning",
  Closed: "success",
};

type DialogState =
  | { readonly kind: "none" }
  | { readonly kind: "configure"; readonly row: CircuitBreakerCatalogRow }
  | { readonly kind: "trip"; readonly row: CircuitBreakerCatalogRow };

/** The editable half of a breaker — exactly the fields `UpdateCircuitBreakerConfig` accepts. */
interface BreakerConfigFormValues {
  readonly failureThreshold: number;
  readonly windowSeconds: number;
  readonly cooldownSeconds: number;
  readonly fallbackStrategy: FallbackStrategy;
  readonly serveCachedWhenDown: boolean;
  readonly cachedAnswerMaxAgeSeconds: number | null;
  readonly degradedModeMessage: string;
  readonly isEnabled: boolean;
}

/**
 * A whole number typed into a numeric field, or `null` when the text is not one — the form
 * refuses to submit rather than coercing a blank box into a zero threshold that would trip a
 * breaker on its first request.
 */
function parseWholeNumber(value: string, minimum: number): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : null;
}

/**
 * What to call a breaker's target, and whether that name is prose or an identifier.
 *
 * `CircuitBreakerConfig` carries either a `targetId` (a row-scoped target: an API connector or
 * MCP server, which live in tabs 2 and 3) or a `targetKey` (a keyed one: a channel, an internal
 * subsystem, which has no row anywhere) — `breakerRef` requires exactly one. A raw `targetId` is
 * a ULID, which tells an operator nothing, so it is resolved to the target's real name from the
 * rows this page already fetched. The `mono` flag is what keeps a resolved *name* out of the
 * monospace treatment reserved for identifiers (§11.3 rule 1).
 */
function breakerTarget(
  row: CircuitBreakerCatalogRow,
  targetNames: Readonly<Record<string, string>>,
): { readonly label: string; readonly mono: boolean } {
  const resolved = row.targetId === null ? undefined : targetNames[row.targetId];
  if (resolved !== undefined) return { label: resolved, mono: false };
  return { label: row.targetKey ?? row.targetId ?? row.id, mono: true };
}

export function CircuitBreakersTab({
  rows,
  targetNames,
  actions,
}: CircuitBreakersTabProps): React.ReactElement {
  const t = useTranslations("tools.circuitBreakers");
  const router = useRouter();
  const [dialog, setDialog] = React.useState<DialogState>({ kind: "none" });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingRowId, setPendingRowId] = React.useState<string | null>(null);

  const stateLabel = React.useCallback(
    (state: BreakerTransition): string =>
      state === "Open"
        ? t("stateOpen")
        : state === "HalfOpen"
          ? t("stateHalfOpen")
          : t("stateClosed"),
    [t],
  );

  const targetKindLabels = React.useMemo<Readonly<Record<CircuitBreakerTargetKind, string>>>(
    () => ({
      ApiConnector: t("targetKindApiConnector"),
      McpServer: t("targetKindMcpServer"),
      Channel: t("targetKindChannel"),
      Internal: t("targetKindInternal"),
    }),
    [t],
  );

  const fallbackLabels = React.useMemo<Readonly<Record<FallbackStrategy, string>>>(
    () => ({
      ApologiseOfferLiveAgent: t("fallbackApologiseOfferLiveAgent"),
      ServeCachedAnswer: t("fallbackServeCachedAnswer"),
      QueueAndRetry: t("fallbackQueueAndRetry"),
      FailClosed: t("fallbackFailClosed"),
    }),
    [t],
  );

  const columns = React.useMemo<ColumnDef<CircuitBreakerCatalogRow, unknown>[]>(
    () => [
      {
        id: "target",
        accessorFn: (row) => breakerTarget(row, targetNames).label,
        header: t("columnTarget"),
        cell: ({ row }) => {
          const target = breakerTarget(row.original, targetNames);
          return target.mono ? <MonoSubLine>{target.label}</MonoSubLine> : target.label;
        },
        meta: { identifying: true },
      },
      {
        id: "targetKind",
        accessorKey: "targetKind",
        header: t("columnTargetKind"),
        cell: ({ row }) => targetKindLabels[row.original.targetKind],
      },
      {
        id: "tripsAt",
        accessorKey: "failureThreshold",
        header: t("columnTripsAt"),
        cell: ({ row }) =>
          t("tripsAtValue", {
            failures: row.original.failureThreshold,
            seconds: row.original.windowSeconds,
          }),
      },
      {
        id: "cooldown",
        accessorKey: "cooldownSeconds",
        header: t("columnCooldown"),
        cell: ({ row }) => t("secondsValue", { seconds: row.original.cooldownSeconds }),
      },
      {
        id: "fallbackStrategy",
        accessorKey: "fallbackStrategy",
        header: t("columnFallback"),
        cell: ({ row }) => fallbackLabels[row.original.fallbackStrategy],
      },
      {
        id: "liveState",
        accessorFn: (row) => row.liveState.state,
        header: t("columnState"),
        cell: ({ row }) => (
          <StatusCell
            label={stateLabel(row.original.liveState.state)}
            family={STATE_FAMILY[row.original.liveState.state]}
            rank={STATE_RANK[row.original.liveState.state]}
          />
        ),
        sortingFn: (a, b) =>
          STATE_RANK[a.original.liveState.state] - STATE_RANK[b.original.liveState.state],
      },
      {
        id: "isEnabled",
        accessorKey: "isEnabled",
        header: t("columnEnabled"),
        cell: ({ row }) => (row.original.isEnabled ? t("yes") : t("no")),
      },
    ],
    [t, targetNames, targetKindLabels, fallbackLabels, stateLabel],
  );

  function onMutationSucceeded(): void {
    setDialog({ kind: "none" });
    setError(null);
    router.refresh();
  }

  async function handleReset(row: CircuitBreakerCatalogRow): Promise<void> {
    setPendingRowId(row.id);
    setError(null);
    const result = await actions.resetCircuitBreaker(row.id);
    setPendingRowId(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.value.ok) {
      setError(t("breakerNotFoundError"));
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-medium text-foreground">{t("heading")}</h2>

      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => breakerTarget(row, targetNames).label}
        caption={t("heading")}
        captionVisuallyHidden
        savingRowIds={new Set(pendingRowId ? [pendingRowId] : [])}
        renderRowActions={(row) => (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDialog({ kind: "configure", row })}
            >
              {t("configureAction")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={pendingRowId === row.id}
              onClick={() => void handleReset(row)}
            >
              {t("resetAction")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDialog({ kind: "trip", row })}
            >
              {t("tripAction")}
            </Button>
          </div>
        )}
      />

      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{t("ruleSummaryBreakerPurpose")}</p>
        <p className="text-sm text-muted-foreground">{t("ruleSummarySeededOpen")}</p>
      </div>

      {dialog.kind === "configure" ? (
        <BreakerConfigDialog
          row={dialog.row}
          fallbackLabels={fallbackLabels}
          pending={pending}
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          onSubmit={async (values) => {
            setPending(true);
            const result = await actions.updateCircuitBreakerConfig({
              id: dialog.row.id,
              ...values,
            });
            setPending(false);
            if (result.ok) onMutationSucceeded();
            else setError(result.error);
          }}
        />
      ) : null}

      {dialog.kind === "trip" ? (
        <TripBreakerDialog
          targetLabel={breakerTarget(dialog.row, targetNames).label}
          pending={pending}
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          onSubmit={async (reason) => {
            setPending(true);
            const result = await actions.tripCircuitBreaker({
              circuitBreakerConfigId: dialog.row.id,
              reason,
            });
            setPending(false);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            if (!result.value.ok) {
              setError(t("breakerNotFoundError"));
              return;
            }
            onMutationSucceeded();
          }}
        />
      ) : null}
    </div>
  );
}

interface BreakerConfigDialogProps {
  readonly row: CircuitBreakerCatalogRow;
  readonly fallbackLabels: Readonly<Record<FallbackStrategy, string>>;
  readonly pending: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (values: BreakerConfigFormValues) => Promise<void>;
}

/**
 * A dialog rather than `DataTable`'s `editable-cell` variant: these eight fields are one
 * decision, not eight independent ones. Raising a failure threshold usually means revisiting
 * the window and the cooldown with it, and turning on "serve cached answers" is meaningless
 * without also saying how stale an answer may be — editing them cell by cell would commit each
 * half-made change to a live, shared dependency guard one keystroke at a time. `editable-cell`
 * remains the right tool where a single value stands alone; here it would fragment one edit.
 */
function BreakerConfigDialog({
  row,
  fallbackLabels,
  pending,
  onOpenChange,
  onSubmit,
}: BreakerConfigDialogProps) {
  const t = useTranslations("tools.circuitBreakers");
  const [failureThreshold, setFailureThreshold] = React.useState(String(row.failureThreshold));
  const [windowSeconds, setWindowSeconds] = React.useState(String(row.windowSeconds));
  const [cooldownSeconds, setCooldownSeconds] = React.useState(String(row.cooldownSeconds));
  const [fallbackStrategy, setFallbackStrategy] = React.useState<FallbackStrategy>(
    row.fallbackStrategy,
  );
  const [serveCachedWhenDown, setServeCachedWhenDown] = React.useState(row.serveCachedWhenDown);
  const [cachedAnswerMaxAgeSeconds, setCachedAnswerMaxAgeSeconds] = React.useState(
    row.cachedAnswerMaxAgeSeconds === null ? "" : String(row.cachedAnswerMaxAgeSeconds),
  );
  const [degradedModeMessage, setDegradedModeMessage] = React.useState(row.degradedModeMessage);
  const [isEnabled, setIsEnabled] = React.useState(row.isEnabled);
  const [numberError, setNumberError] = React.useState<string | null>(null);
  const serveCachedId = React.useId();
  const enabledId = React.useId();

  function handleSubmit(): void {
    const parsedThreshold = parseWholeNumber(failureThreshold, 1);
    const parsedWindow = parseWholeNumber(windowSeconds, 1);
    const parsedCooldown = parseWholeNumber(cooldownSeconds, 1);
    if (parsedThreshold === null || parsedWindow === null || parsedCooldown === null) {
      setNumberError(t("invalidNumberError"));
      return;
    }

    // A blank max-age is a real value — `null` means "no age limit recorded", which is distinct
    // from any number an empty box could be coerced into.
    const trimmedMaxAge = cachedAnswerMaxAgeSeconds.trim();
    let parsedMaxAge: number | null = null;
    if (trimmedMaxAge.length > 0) {
      parsedMaxAge = parseWholeNumber(trimmedMaxAge, 1);
      if (parsedMaxAge === null) {
        setNumberError(t("invalidNumberError"));
        return;
      }
    }

    setNumberError(null);
    void onSubmit({
      failureThreshold: parsedThreshold,
      windowSeconds: parsedWindow,
      cooldownSeconds: parsedCooldown,
      fallbackStrategy,
      serveCachedWhenDown,
      cachedAnswerMaxAgeSeconds: parsedMaxAge,
      degradedModeMessage,
      isEnabled,
    });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="lg" closeLabel={t("closeLabel")}>
        <DialogHeader>
          <DialogTitle>{t("configureDialogTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          <FormField
            label={t("fieldFailureThreshold")}
            {...(numberError !== null ? { error: numberError } : {})}
          >
            {(field) => (
              <Input
                {...field}
                type="number"
                inputMode="numeric"
                value={failureThreshold}
                onChange={(event) => setFailureThreshold(event.target.value)}
                required
              />
            )}
          </FormField>
          <FormField label={t("fieldWindowSeconds")}>
            {(field) => (
              <Input
                {...field}
                type="number"
                inputMode="numeric"
                value={windowSeconds}
                onChange={(event) => setWindowSeconds(event.target.value)}
                required
              />
            )}
          </FormField>
          <FormField label={t("fieldCooldownSeconds")}>
            {(field) => (
              <Input
                {...field}
                type="number"
                inputMode="numeric"
                value={cooldownSeconds}
                onChange={(event) => setCooldownSeconds(event.target.value)}
                required
              />
            )}
          </FormField>
          <FormField label={t("fieldFallbackStrategy")}>
            {(field) => (
              <Select
                value={fallbackStrategy}
                onValueChange={(value) => setFallbackStrategy(value as FallbackStrategy)}
              >
                <SelectTrigger {...field}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FALLBACK_STRATEGIES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {fallbackLabels[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor={serveCachedId}>{t("fieldServeCachedWhenDown")}</Label>
            <Switch
              id={serveCachedId}
              checked={serveCachedWhenDown}
              onCheckedChange={setServeCachedWhenDown}
            />
          </div>

          <FormField
            label={t("fieldCachedAnswerMaxAgeSeconds")}
            labelVariant="optional"
            help={t("fieldCachedAnswerMaxAgeHelp")}
          >
            {(field) => (
              <Input
                {...field}
                type="number"
                inputMode="numeric"
                value={cachedAnswerMaxAgeSeconds}
                onChange={(event) => setCachedAnswerMaxAgeSeconds(event.target.value)}
              />
            )}
          </FormField>

          <FormField label={t("fieldDegradedModeMessage")} help={t("fieldDegradedModeHelp")}>
            {(field) => (
              <Textarea
                {...field}
                value={degradedModeMessage}
                onChange={(event) => setDegradedModeMessage(event.target.value)}
                required
              />
            )}
          </FormField>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor={enabledId}>{t("fieldIsEnabled")}</Label>
            <Switch id={enabledId} checked={isEnabled} onCheckedChange={setIsEnabled} />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" loading={pending}>
              {t("configureDialogSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface TripBreakerDialogProps {
  /** The target's display name, resolved by the tab (which owns the id→name map). */
  readonly targetLabel: string;
  readonly pending: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (reason: string) => Promise<void>;
}

/**
 * Manual trip needs a real justification, so it needs a real field.
 *
 * `TripCircuitBreaker` requires a non-empty `reason` (it throws on a blank one) and is candid
 * that no column persists it yet — no free-text field exists on `CircuitBreakerEvent`. A
 * hardcoded constant would satisfy today's contract and become a lie the day that column
 * lands, so the operator types the reason and it is passed through unchanged. The dialog says
 * plainly that it is not stored yet, rather than implying an audit trail that does not exist.
 */
function TripBreakerDialog({
  targetLabel,
  pending,
  onOpenChange,
  onSubmit,
}: TripBreakerDialogProps) {
  const t = useTranslations("tools.circuitBreakers");
  const [reason, setReason] = React.useState("");

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="sm" closeLabel={t("closeLabel")}>
        <DialogHeader>
          <DialogTitle>{t("tripDialogTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit(reason);
          }}
        >
          <p className="text-sm text-muted-foreground">
            {t("tripDialogDescription", { name: targetLabel })}
          </p>
          <FormField label={t("fieldTripReason")} help={t("fieldTripReasonHelp")}>
            {(field) => (
              <Input
                {...field}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
              />
            )}
          </FormField>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" variant="destructive" loading={pending}>
              {t("tripDialogSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
