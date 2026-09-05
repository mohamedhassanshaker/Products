"use client";

import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { AccessDeniedState } from "@nextbot/ui";
import { cn } from "@nextbot/ui/lib/utils";
import { fetchJson } from "@/src/lib/fetch-json";

interface AuditEntry {
  id: string;
  occurredAt: string;
  actorLabel: string;
  actionType: string;
  targetType: string | null;
  targetId: string | null;
  outcome: "Success" | "Failure" | "Denied";
  details: Record<string, unknown>;
}

/** Base UI's `Select` can't represent "no value selected" via an empty string the
 * way Chakra's `placeholder` prop did — see `ToolCatalog.tsx`'s identical note. */
const ALL_OUTCOMES = "__all__";

/**
 * B.8.2 Audit Log Viewer — timestamp/actor/action-type/target/details/outcome,
 * filters (action type, target type, actor, date-range, outcome, free-text
 * search — QA fix UI-D1: date-range/actor/action-type/target were previously
 * missing from the UI despite the backend already accepting all of them), a
 * masked-detail drawer (clicking a row expands `details`, masked server-side via
 * `queryMaskedAuditLog` before this component ever receives it — QA fix UI-D2:
 * the frontend renders whatever `details` the API returns verbatim, so the masking
 * guarantee lives entirely in the already-QA-fixed backend query, not here), CSV/
 * JSON export.
 */
export function AuditLogViewer() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState("");
  const [actionType, setActionType] = useState("");
  const [targetType, setTargetType] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  async function reload() {
    setError(null);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (outcome) params.set("outcome", outcome);
    if (actionType) params.set("actionType", actionType);
    if (targetType) params.set("targetType", targetType);
    if (actor) params.set("actor", actor);
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(to).toISOString());
    const result = await fetchJson<{ entries: AuditEntry[] }>(`/api/v1/admin/audit-log?${params}`);
    if (result.kind === "forbidden") return setForbidden(true);
    if (result.kind === "error") return setError(result.message);
    setEntries(result.data.entries);
  }

  useEffect(() => {
    void reload();
    // Deliberately empty deps — this effect should only run once on mount, not on
    // every `search`/`outcome` filter change (the "Apply filters" button drives
    // re-fetches explicitly).
  }, []);

  if (forbidden) return <AccessDeniedState moduleLabel="Audit Log" />;

  return (
    <div className="p-6">
      <h1 className="mb-4 font-heading text-lg font-semibold">Audit Log</h1>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {/*
       * QA fix pass (client-feedback-batch, proactive audit item 3 — the actual root
       * cause of the 9/20 (45%) `/audit-log` mismatch first suspected against the
       * Outcome `Select` above; the live hydration diff instead pointed at these four
       * plain `Input`s). `input.tsx`'s `Input` wraps Base UI's `Input`, itself built on
       * `Field.Control`, whose rendered `id` is `useLabelableId({ id: idProp })`
       * (`field/control/FieldControl.mjs`) — an internally-generated fallback whenever
       * no explicit `id` is supplied. This page's `entries === null ? <Skeleton> :
       * <Table>` branch further down the same tree gives the server render and the
       * client's first (hydration) render a genuinely different shape, which shifts
       * every `React.useId()`-based id on the page — including these four inputs',
       * even though they sit *before* the branch in JSX source order (same mechanism
       * already documented in `tabs.tsx`/`tooltip.tsx`). `input.tsx` already forwards
       * a caller-supplied `id` straight through (plain prop spread, already
       * authoritative over the generated fallback), so — same as `FieldHint`/
       * `TabsTrigger` — the fix is an explicit, stable id at this call site, not a
       * primitive-level change. Not applied project-wide to every other `Input` call
       * site: `input.tsx` is used far too broadly to force a required-`id` prop across
       * the whole codebase on the strength of one proven caller (this project's own
       * `Tooltip`/`FieldHint` precedent leaves other unproven callers of a shared
       * primitive untouched, out of scope, rather than fixing on suspicion alone).
       */}
      <div className="mb-2 flex flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-1">
            <Label htmlFor="audit-log-filter-search" className="sr-only">
              Search
            </Label>
            <FieldHint
              id="audit-log-filter-search-hint"
              content="Full-text search across the action type, actor, and target fields of each audit entry — combined with the other filters using AND."
            />
          </div>
          <Input id="audit-log-filter-search" placeholder="Search action/actor/target..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[280px]" />
        </div>
        <div>
          <div className="flex items-center gap-1">
            <Label htmlFor="audit-log-filter-actor" className="sr-only">
              Actor id
            </Label>
            <FieldHint
              id="audit-log-filter-actor-hint"
              content="Filters to audit entries whose actor matches this id/label exactly — check the Actor column below to find the value to enter."
            />
          </div>
          <Input id="audit-log-filter-actor" placeholder="Actor id" value={actor} onChange={(e) => setActor(e.target.value)} className="max-w-[180px]" />
        </div>
        <div>
          <div className="flex items-center gap-1">
            <Label htmlFor="audit-log-filter-action-type" className="sr-only">
              Action type
            </Label>
            <FieldHint
              id="audit-log-filter-action-type-hint"
              content="Filters to audit entries whose action type matches this text (e.g. role.update, user.invite) — see the Action column below for exact values."
            />
          </div>
          <Input id="audit-log-filter-action-type" placeholder="Action type" value={actionType} onChange={(e) => setActionType(e.target.value)} className="max-w-[180px]" />
        </div>
        <div>
          <div className="flex items-center gap-1">
            <Label htmlFor="audit-log-filter-target-type" className="sr-only">
              Target type
            </Label>
            <FieldHint
              id="audit-log-filter-target-type-hint"
              content="Filters to audit entries whose target type matches this text (e.g. Role, User) — see the Target column's prefix below for exact values."
            />
          </div>
          <Input id="audit-log-filter-target-type" placeholder="Target type" value={targetType} onChange={(e) => setTargetType(e.target.value)} className="max-w-[160px]" />
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="audit-log-from" className="text-sm">
            From
          </Label>
          <FieldHint
            id="audit-log-from-hint"
            content="Only includes audit entries that occurred on or after this date (inclusive) — combine with To to bound a specific range."
          />
          <Input id="audit-log-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="max-w-[160px]" />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="audit-log-to" className="text-sm">
            To
          </Label>
          <FieldHint
            id="audit-log-to-hint"
            content="Only includes audit entries that occurred on or before this date (inclusive) — combine with From to bound a specific range."
          />
          <Input id="audit-log-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="max-w-[160px]" />
        </div>
        {/* QA fix (UI-D1): Outcome values match the real `audit_outcome` enum
            (Success/Failure/Denied) — see `apps/web/app/api/v1/admin/audit-log/
            route.ts`'s doc comment for the flagged spec-wording ("Pending")
            vs. actual-schema ("Denied") discrepancy this was reconciled against. */}
        {/*
         * QA fix pass (client-feedback-batch, proactive audit item 2 — reproduced live
         * on `/audit-log` at 9/20 (45%) fresh-load repro rate). Same defect class as
         * `tabs.tsx`'s `TabsTrigger`/`TabsContent` (see that file's doc comment for the
         * full root-cause writeup): Base UI's `Select.Root` writes its Trigger's `id`
         * from an internally-generated `useBaseUiId(id)` fallback
         * (`select/root/SelectRoot.mjs`'s `useLabelableId`) whenever the caller doesn't
         * supply one, and this page's `entries === null ? <Skeleton> : <Table>` branch
         * further down the same component tree gives the server render and the
         * client's first (hydration) render a genuinely different shape, shifting
         * every `React.useId()`-based id on the page (confirmed empirically — this
         * `Select` sits *before* the branch in JSX source order, yet still exhibited
         * the mismatch). `select.tsx`'s `SelectTrigger` already forwards a caller-
         * supplied `id` straight through to Base UI (plain prop spread, already
         * authoritative over the generated fallback — no primitive code change
         * needed), so the fix here is the same caller-supplied-explicit-id contract
         * `FieldHint`/`TabsTrigger` already established, applied at this call site.
         */}
        <FieldHint
          id="audit-log-outcome-filter-hint"
          content="Filters to entries with this outcome — Denied means blocked by a permission/guardrail check, distinct from Failure (an error during an otherwise-permitted action)."
        />
        <Select value={outcome || ALL_OUTCOMES} onValueChange={(v) => v !== null && setOutcome(v === ALL_OUTCOMES ? "" : v)}>
          <SelectTrigger id="audit-log-outcome-filter" className="w-[160px]" aria-label="Outcome">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_OUTCOMES}>Any outcome</SelectItem>
            <SelectItem value="Success">Success</SelectItem>
            <SelectItem value="Failure">Failure</SelectItem>
            <SelectItem value="Denied">Denied</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => void reload()}>Apply filters</Button>
        <a href="/api/v1/admin/audit-log/export?format=csv" className={cn(buttonVariants({ variant: "outline" }))}>
          Export CSV
        </a>
        <a href="/api/v1/admin/audit-log/export?format=json" className={cn(buttonVariants({ variant: "outline" }))}>
          Export JSON
        </a>
      </div>

      {entries === null ? (
        <Skeleton className="h-8 w-32" role="status" aria-label="Loading audit log" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id} onClick={() => setSelected(e)} className="cursor-pointer">
                <TableCell>{new Date(e.occurredAt).toLocaleString()}</TableCell>
                <TableCell>{e.actorLabel}</TableCell>
                <TableCell>{e.actionType}</TableCell>
                <TableCell>{e.targetType ? `${e.targetType}:${e.targetId ?? ""}` : "—"}</TableCell>
                <TableCell>{e.outcome}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {selected && (
        <div className="mt-6 rounded-none border p-4">
          <h2 className="mb-2 font-heading text-sm font-semibold">Detail — {selected.actionType}</h2>
          <div className="flex flex-col items-start gap-1">
            <p>
              <b>Actor:</b> {selected.actorLabel}
            </p>
            <p>
              <b>Outcome:</b> {selected.outcome}
            </p>
            <p>
              <b>Details:</b>
            </p>
            <pre className="max-w-full overflow-x-auto rounded-none bg-muted/50 p-2 text-xs">{JSON.stringify(selected.details, null, 2)}</pre>
          </div>
          <Button className="mt-2" size="sm" onClick={() => setSelected(null)}>
            Close
          </Button>
        </div>
      )}
    </div>
  );
}
