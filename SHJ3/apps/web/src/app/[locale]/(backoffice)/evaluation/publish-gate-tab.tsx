"use client";

/** B13 tab 3 — the five publish-gate settings and the live consequence strip (FR-EVAL-07
 *  through FR-EVAL-13). */
import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SummaryStrip, type BlockingCondition } from "@/components/ui/summary-strip";
import type { PublishGateRow } from "../../../../modules/evaluation/ports/publish-gate-repository.js";
import type { EvaluationScreenActions } from "./evaluation-screen.js";
import type { GateStatusSummaryDisplay } from "./actions.js";

type DisplayedGateReason = NonNullable<
  GateStatusSummaryDisplay["blockedVersion"]
>["reasons"][number];

function toBlockingCondition(reason: DisplayedGateReason): BlockingCondition {
  const isPercentAlready = reason.metric === "boundLocale";
  const measured = isPercentAlready
    ? `${Math.round(reason.observed)}%`
    : `${Math.round(reason.observed * 100)}%`;
  const threshold = isPercentAlready
    ? `${Math.round(reason.threshold)}%`
    : `${Math.round(reason.threshold * 100)}%`;
  const blocked = reason.goldenSetName ?? reason.localeCode ?? reason.metric;
  const source =
    reason.metric === "boundLocale"
      ? "B10 tab 5"
      : reason.metric === "suiteFailure"
        ? "B13 tab 1"
        : "B13 tab 2";
  return { blocked, measured, threshold, source };
}

export function PublishGateTab({
  publishGate,
  gateStatus,
  actions,
}: {
  readonly publishGate: PublishGateRow;
  readonly gateStatus: GateStatusSummaryDisplay;
  readonly actions: EvaluationScreenActions;
}) {
  const t = useTranslations("evaluation");
  const [gate, setGate] = React.useState(publishGate);
  const [status, setStatus] = React.useState(gateStatus);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await actions.updatePublishGate({
      blockOnSuiteFailure: gate.blockOnSuiteFailure,
      minAccuracy: gate.minAccuracy,
      minGroundedness: gate.minGroundedness,
      redTeamMustScore100: gate.redTeamMustScore100,
      blockOnBoundLocaleBelow100: gate.blockOnBoundLocaleBelow100,
    });
    if (result.ok) {
      setGate(result.value);
      const refreshed = await actions.getGateStatusSummary();
      if (refreshed.ok) setStatus(refreshed.value);
    } else {
      setError(result.error);
    }
    setSaving(false);
  }

  function handleReset() {
    setGate({
      ...gate,
      blockOnSuiteFailure: true,
      minAccuracy: 0.85,
      minGroundedness: 0.8,
      redTeamMustScore100: true,
      blockOnBoundLocaleBelow100: true,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle level={2}>{t("publishGate.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error ? <p className="text-sm text-destructive-strong">{error}</p> : null}

          <div className="flex items-center justify-between border-b border-border pb-3">
            <span className="text-sm text-foreground">{t("publishGate.blockOnSuiteFailure")}</span>
            <Switch
              checked={gate.blockOnSuiteFailure}
              onCheckedChange={(checked) =>
                setGate({ ...gate, blockOnSuiteFailure: checked === true })
              }
            />
          </div>

          <div className="flex items-center justify-between border-b border-border pb-3">
            <span className="text-sm text-foreground">{t("publishGate.minAccuracy")}</span>
            <Input
              type="number"
              min={0}
              max={100}
              className="w-24"
              value={Math.round(gate.minAccuracy * 100)}
              onChange={(e) => setGate({ ...gate, minAccuracy: Number(e.target.value) / 100 })}
              endAdornment="%"
            />
          </div>

          <div className="flex items-center justify-between border-b border-border pb-3">
            <span className="text-sm text-foreground">{t("publishGate.minGroundedness")}</span>
            <Input
              type="number"
              min={0}
              max={100}
              className="w-24"
              value={Math.round(gate.minGroundedness * 100)}
              onChange={(e) => setGate({ ...gate, minGroundedness: Number(e.target.value) / 100 })}
              endAdornment="%"
            />
          </div>

          <div className="flex items-center justify-between border-b border-border pb-3">
            <span className="text-sm text-foreground">{t("publishGate.redTeamMustScore100")}</span>
            <Switch
              checked={gate.redTeamMustScore100}
              onCheckedChange={(checked) =>
                setGate({ ...gate, redTeamMustScore100: checked === true })
              }
            />
          </div>

          <div className="flex items-center justify-between pb-1">
            <span className="text-sm text-foreground">
              {t("publishGate.blockOnBoundLocaleBelow100")}
            </span>
            <Switch
              checked={gate.blockOnBoundLocaleBelow100}
              onCheckedChange={(checked) =>
                setGate({ ...gate, blockOnBoundLocaleBelow100: checked === true })
              }
            />
          </div>

          {!gate.blockOnSuiteFailure ? (
            <p className="text-xs text-muted-foreground">{t("publishGate.suiteFailureOffNote")}</p>
          ) : null}

          <div className="flex gap-2">
            <Button onClick={handleSave} loading={saving}>
              {t("publishGate.save")}
            </Button>
            <Button variant="outline" onClick={handleReset}>
              {t("publishGate.resetToDefault")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {!status.gateActive ? (
        <SummaryStrip variant="consequence">{t("publishGate.consequenceOff")}</SummaryStrip>
      ) : status.blockedVersion ? (
        <SummaryStrip
          variant="blocking"
          subject={`${status.blockedVersion.agentName} ${status.blockedVersion.versionLabel}`}
          conditions={
            status.blockedVersion.reasons.length > 0
              ? (status.blockedVersion.reasons.map(toBlockingCondition) as [
                  BlockingCondition,
                  ...BlockingCondition[],
                ])
              : [
                  {
                    blocked: t("publishGate.unknownCondition"),
                    measured: "—",
                    threshold: "—",
                    source: "B13",
                  },
                ]
          }
        />
      ) : (
        <SummaryStrip variant="rule">{t("publishGate.consequenceOnNoBlock")}</SummaryStrip>
      )}
    </div>
  );
}
