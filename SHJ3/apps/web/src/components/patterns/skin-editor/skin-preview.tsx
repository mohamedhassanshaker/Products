"use client";

/**
 * §9.1's live preview pane: "the real components, not screenshots — a Card with a
 * Badge of each family, a Button row, a DataTable of three rows, a SubTabBar, a
 * Switch, a ProgressBar, a SummaryStrip, and a two-turn ChatThread showing both
 * bubble tints." Every one of those is the real, already-built component — this file
 * renders no static markup standing in for any of them.
 *
 * The candidate's tokens are applied to THIS component's own root via
 * `apply-candidate.ts` — the caller (`skin-editor.tsx`) owns the effect that calls
 * `applyCandidate`/reverts it, passing the scope element down via `ref`, so this
 * component stays a plain, testable render and the live-preview MECHANISM stays in
 * one place (already proven independently in `apply-candidate.test.ts`).
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Switch } from "@/components/ui/switch";
import { SubTabBar, SubTabBarPanel } from "@/components/ui/sub-tab-bar";
import { SummaryStrip } from "@/components/ui/summary-strip";
import { DataTable } from "@/components/patterns/data-table/data-table";
import { ChatThread, type ChatTurn } from "@/components/patterns/chat-thread";

interface PreviewRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

// forwardRef's render function is always called with two positional arguments; this
// component genuinely takes no props, and there is no naming convention this
// project's no-unused-vars config (`argsIgnorePattern: "^$"`) treats as exempt, so
// the unused first parameter is disabled on the one line below rather than fought
// with an empty-object pattern (which trips `no-empty-pattern` instead).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const SkinPreview = React.forwardRef<HTMLDivElement>(function SkinPreview(props, ref) {
  const t = useTranslations("skinEditor.preview");
  const [switchOn, setSwitchOn] = React.useState(true);

  const rows: PreviewRow[] = React.useMemo(
    () => [
      { id: "1", name: "SEWA", status: "Healthy" },
      { id: "2", name: "Customs", status: "Degraded" },
      { id: "3", name: "RTA", status: "Healthy" },
    ],
    [],
  );
  const columns = React.useMemo<ColumnDef<PreviewRow, unknown>[]>(
    () => [
      { id: "name", accessorKey: "name", header: t("columnName"), meta: { identifying: true } },
      { id: "status", accessorKey: "status", header: t("columnStatus") },
    ],
    [t],
  );

  const chatTurns: ChatTurn[] = React.useMemo(
    () => [
      {
        id: "preview-user",
        role: "user",
        text: t("chatUserTurn"),
        timestamp: new Date("2026-09-08T10:00:00Z"),
      },
      {
        id: "preview-assistant",
        role: "assistant",
        text: t("chatAssistantTurn"),
        timestamp: new Date("2026-09-08T10:00:05Z"),
      },
    ],
    [t],
  );

  return (
    <div ref={ref} className="flex flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle level={3}>{t("cardTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="success" label={t("badgeHealthy")} />
            <Badge variant="warning" label={t("badgeDegraded")} />
            <Badge variant="destructive" label={t("badgeFailed")} />
            <Badge variant="info" label={t("badgeInfo")} />
            <Badge variant="neutral" label={t("badgeNeutral")} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="primary" size="sm">
              {t("buttonPrimary")}
            </Button>
            <Button type="button" variant="secondary" size="sm">
              {t("buttonSecondary")}
            </Button>
            <Button type="button" variant="outline" size="sm">
              {t("buttonOutline")}
            </Button>
            <Button type="button" variant="destructive" size="sm">
              {t("buttonDestructive")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        caption={t("listCaption")}
      />

      <SubTabBar
        tabs={[
          { value: "a", label: t("tabOne") },
          { value: "b", label: t("tabTwo") },
        ]}
        aria-label={t("tabsAriaLabel")}
        urlParam={null}
      >
        <SubTabBarPanel value="a">{t("tabOne")}</SubTabBarPanel>
        <SubTabBarPanel value="b">{t("tabTwo")}</SubTabBarPanel>
      </SubTabBar>

      <div className="flex items-center gap-3">
        <Switch checked={switchOn} onCheckedChange={setSwitchOn} />
        <span className="text-sm text-foreground">{t("switchLabel")}</span>
      </div>

      <ProgressBar value={62} />

      <SummaryStrip variant="rule">{t("cardSubLine")}</SummaryStrip>

      {/* A fixed rem height, not a Tailwind numeric-scale utility: this project's
          Tailwind v4 theme has no bridged numeric spacing scale beyond the token
          steps packages/tokens actually defines (§3.4) — the same reasoning
          AssistantWidgetShell's own local rem constants document for a genuinely
          geometric, non-derived size with no token to reach for. */}
      <div style={{ height: "20rem" }}>
        <ChatThread turns={chatTurns} aria-label={t("chatAriaLabel")} />
      </div>
    </div>
  );
});
