"use client";

/**
 * B13 tab 1 — Set/Cases/Owner/Last score, **Run now** (rescores live), **Edit cases**,
 * and creating a new set. `Run now` needs a target `{agentId, agentVersionId}` — this
 * screen has no stored "which agent does this set normally check" association
 * (`run-golden-set-now.ts`'s own doc comment explains why: the real schema has none), so
 * it defaults to the most recent prior run's own target for that set, editable inline.
 *
 * Built on `DataTable` (`components/patterns/data-table/`) — design-system.md §5.5 #41's
 * "wrapped once, reused everywhere" rule, enforced mechanically by `gate:table`.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/patterns/data-table/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Switch } from "@/components/ui/switch";
import type { GoldenSetKind } from "../../../../modules/evaluation/domain/vocabulary.js";
import type {
  GoldenCaseRow,
  GoldenSetRow,
} from "../../../../modules/evaluation/ports/golden-set-repository.js";
import type { RegressionRunRow } from "../../../../modules/evaluation/ports/regression-run-repository.js";
import type { EvaluationScreenActions } from "./evaluation-screen.js";

function lastPairingFor(goldenSetId: string, runs: readonly RegressionRunRow[]) {
  const match = runs.find((r) => r.goldenSetId === goldenSetId);
  return { agentId: match?.agentId ?? "", agentVersionId: match?.agentVersionId ?? "" };
}

function CaseEditor({
  goldenSetId,
  cases,
  actions,
  onCasesChanged,
}: {
  readonly goldenSetId: string;
  readonly cases: readonly GoldenCaseRow[];
  readonly actions: EvaluationScreenActions;
  readonly onCasesChanged: (cases: readonly GoldenCaseRow[]) => void;
}) {
  const t = useTranslations("evaluation");
  const [prompt, setPrompt] = React.useState("");
  const [expectedBehaviour, setExpectedBehaviour] = React.useState("");
  const [mustRefuse, setMustRefuse] = React.useState(false);
  const [localeCode, setLocaleCode] = React.useState("en");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function handleAdd() {
    setBusy(true);
    setError(null);
    const result = await actions.addGoldenCase({
      goldenSetId,
      prompt,
      expectedBehaviour,
      mustRefuse,
      localeCode,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCasesChanged([...cases, result.value]);
    setPrompt("");
    setExpectedBehaviour("");
    setMustRefuse(false);
  }

  async function handleRemove(goldenCaseId: string) {
    const result = await actions.removeGoldenCase(goldenCaseId);
    if (result.ok) onCasesChanged(cases.filter((c) => c.id !== goldenCaseId));
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
      <ul className="flex flex-col gap-2">
        {cases.map((goldenCase) => (
          <li
            key={goldenCase.id}
            className="flex items-start justify-between gap-3 rounded-md border border-border p-2 text-sm"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">{goldenCase.prompt}</p>
              <p className="text-muted-foreground">{goldenCase.expectedBehaviour}</p>
              {goldenCase.mustRefuse ? (
                <p className="text-xs text-muted-foreground">{t("goldenSets.mustRefuseBadge")}</p>
              ) : null}
            </div>
            <Button variant="ghost" size="sm" onClick={() => handleRemove(goldenCase.id)}>
              {t("goldenSets.removeCase")}
            </Button>
          </li>
        ))}
        {cases.length === 0 ? (
          <li className="text-sm text-muted-foreground">{t("goldenSets.noCases")}</li>
        ) : null}
      </ul>
      <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
        <Input
          placeholder={t("goldenSets.promptPlaceholder")}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <Input
          placeholder={t("goldenSets.expectedBehaviourPlaceholder")}
          value={expectedBehaviour}
          onChange={(e) => setExpectedBehaviour(e.target.value)}
        />
        <div className="flex items-center gap-4">
          <Input
            variant="mono"
            className="max-w-24"
            value={localeCode}
            onChange={(e) => setLocaleCode(e.target.value)}
            aria-label={t("goldenSets.localeCodeLabel")}
          />
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Switch
              checked={mustRefuse}
              onCheckedChange={(checked) => setMustRefuse(checked === true)}
            />
            {t("goldenSets.mustRefuseLabel")}
          </label>
        </div>
        <Button
          size="sm"
          onClick={handleAdd}
          loading={busy}
          disabled={!prompt || !expectedBehaviour}
        >
          {t("goldenSets.addCase")}
        </Button>
      </div>
    </div>
  );
}

function RunNowControls({
  set,
  runs,
  actions,
  onSetChanged,
  onRunRecorded,
}: {
  readonly set: GoldenSetRow;
  readonly runs: readonly RegressionRunRow[];
  readonly actions: EvaluationScreenActions;
  readonly onSetChanged: (set: GoldenSetRow) => void;
  readonly onRunRecorded: (run: RegressionRunRow) => void;
}) {
  const t = useTranslations("evaluation");
  const defaults = lastPairingFor(set.id, runs);
  const [agentId, setAgentId] = React.useState(defaults.agentId);
  const [agentVersionId, setAgentVersionId] = React.useState(defaults.agentVersionId);
  const [runError, setRunError] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);

  async function handleRunNow() {
    setRunning(true);
    setRunError(null);
    const result = await actions.runGoldenSetNow({ goldenSetId: set.id, agentId, agentVersionId });
    setRunning(false);
    if (!result.ok) {
      setRunError(result.error);
      return;
    }
    onRunRecorded(result.value);
    onSetChanged({ ...set, lastScore: result.value.accuracy, lastRunAt: result.value.finishedAt });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Input
          variant="mono"
          className="w-28"
          placeholder={t("goldenSets.agentIdPlaceholder")}
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          aria-label={t("goldenSets.agentIdLabel")}
        />
        <Input
          variant="mono"
          className="w-28"
          placeholder={t("goldenSets.agentVersionIdPlaceholder")}
          value={agentVersionId}
          onChange={(e) => setAgentVersionId(e.target.value)}
          aria-label={t("goldenSets.agentVersionIdLabel")}
        />
        <Button
          size="sm"
          onClick={handleRunNow}
          loading={running}
          disabled={!agentId || !agentVersionId}
        >
          {t("goldenSets.runNow")}
        </Button>
      </div>
      {runError ? <p className="text-xs text-destructive-strong">{runError}</p> : null}
    </div>
  );
}

function CreateGoldenSetForm({
  actions,
  onCreated,
}: {
  readonly actions: EvaluationScreenActions;
  readonly onCreated: (set: GoldenSetRow) => void;
}) {
  const t = useTranslations("evaluation");
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<GoldenSetKind>("Journey");
  const [localeCode, setLocaleCode] = React.useState("");
  const [ownerTenantId, setOwnerTenantId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    const result = await actions.createGoldenSet({
      name,
      ownerTenantId,
      description: null,
      kind,
      localeCode: kind === "LanguageParity" ? localeCode || null : null,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCreated(result.value);
    setName("");
    setOwnerTenantId("");
    setLocaleCode("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>{t("goldenSets.createTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-2">
        {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
        <Input
          placeholder={t("goldenSets.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          placeholder={t("goldenSets.ownerTenantIdPlaceholder")}
          value={ownerTenantId}
          onChange={(e) => setOwnerTenantId(e.target.value)}
        />
        <select
          className="h-9 rounded-md border border-border-strong bg-transparent px-2 text-sm text-foreground"
          value={kind}
          onChange={(e) => setKind(e.target.value as GoldenSetKind)}
          aria-label={t("goldenSets.kindLabel")}
        >
          <option value="Journey">Journey</option>
          <option value="LanguageParity">LanguageParity</option>
          <option value="RedTeam">RedTeam</option>
          <option value="ToolAccuracy">ToolAccuracy</option>
        </select>
        {kind === "LanguageParity" ? (
          <Input
            variant="mono"
            className="w-24"
            placeholder={t("goldenSets.localeCodeLabel")}
            value={localeCode}
            onChange={(e) => setLocaleCode(e.target.value)}
          />
        ) : null}
        <Button onClick={handleCreate} loading={busy} disabled={!name || !ownerTenantId}>
          {t("goldenSets.create")}
        </Button>
      </CardContent>
    </Card>
  );
}

export function GoldenSetsTab({
  goldenSets,
  regressionRuns,
  actions,
  onSetsChanged,
  onRunRecorded,
}: {
  readonly goldenSets: readonly GoldenSetRow[];
  readonly regressionRuns: readonly RegressionRunRow[];
  readonly actions: EvaluationScreenActions;
  readonly onSetsChanged: (sets: readonly GoldenSetRow[]) => void;
  readonly onRunRecorded: (run: RegressionRunRow) => void;
}) {
  const t = useTranslations("evaluation");
  const [expandedIds, setExpandedIds] = React.useState<ReadonlySet<string>>(new Set());
  const [casesBySetId, setCasesBySetId] = React.useState<
    Readonly<Record<string, readonly GoldenCaseRow[]>>
  >({});

  function updateSet(updated: GoldenSetRow) {
    onSetsChanged(goldenSets.map((s) => (s.id === updated.id ? updated : s)));
  }

  async function handleExpandedIdsChange(next: ReadonlySet<string>) {
    setExpandedIds(next);
    for (const goldenSetId of next) {
      if (casesBySetId[goldenSetId]) continue;
      const result = await actions.getGoldenSet(goldenSetId);
      if (result.ok && result.value) {
        setCasesBySetId((prev) => ({ ...prev, [goldenSetId]: result.value!.cases }));
      }
    }
  }

  const columns = React.useMemo<ColumnDef<GoldenSetRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: t("goldenSets.columnSet"),
        meta: { identifying: true },
      },
      {
        id: "caseCount",
        accessorKey: "caseCount",
        header: t("goldenSets.columnCases"),
        meta: { mono: true },
      },
      {
        id: "ownerTenantId",
        accessorKey: "ownerTenantId",
        header: t("goldenSets.columnOwner"),
      },
      {
        id: "lastScore",
        header: t("goldenSets.columnLastScore"),
        cell: ({ row }) =>
          row.original.lastScore === null
            ? t("goldenSets.noScore")
            : `${Math.round(row.original.lastScore * 100)}%`,
      },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-4">
      <CreateGoldenSetForm
        actions={actions}
        onCreated={(set) => onSetsChanged([...goldenSets, set])}
      />
      <Card>
        <CardContent>
          <DataTable<GoldenSetRow>
            columns={columns}
            data={goldenSets}
            getRowId={(row) => row.id}
            caption={t("goldenSets.columnSet")}
            captionVisuallyHidden
            status={goldenSets.length === 0 ? "empty" : "ready"}
            emptyContent={
              <EmptyState
                headline={t("goldenSets.emptyTitle")}
                cause={t("goldenSets.emptyDescription")}
              />
            }
            expandable
            expandedIds={expandedIds}
            onExpandedIdsChange={handleExpandedIdsChange}
            renderExpandedRow={(set) =>
              casesBySetId[set.id] ? (
                <CaseEditor
                  goldenSetId={set.id}
                  cases={casesBySetId[set.id]!}
                  actions={actions}
                  onCasesChanged={(cases) =>
                    setCasesBySetId((prev) => ({ ...prev, [set.id]: cases }))
                  }
                />
              ) : null
            }
            renderRowActions={(set) => (
              <RunNowControls
                set={set}
                runs={regressionRuns}
                actions={actions}
                onSetChanged={updateSet}
                onRunRecorded={onRunRecorded}
              />
            )}
          />
        </CardContent>
      </Card>
    </div>
  );
}
