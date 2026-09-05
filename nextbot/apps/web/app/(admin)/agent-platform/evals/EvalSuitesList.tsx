"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@nextbot/ui/components/ui/dialog";
import { fetchJson } from "@/src/lib/fetch-json";

interface EvalSuiteItem {
  id: string;
  name: string;
  description: string | null;
  passThresholdPct: string;
}

/** BL-07 Eval Suite Runner — suite CRUD list (UX_GUIDELINES.md §6.5). Suites are a
 * reusable, shared library; *running* a suite happens on a version's Eval tab. */
export function EvalSuitesList({ canWrite }: { canWrite: boolean }) {
  const [suites, setSuites] = useState<EvalSuiteItem[] | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [passThreshold, setPassThreshold] = useState(100);
  // U6 fix (QA 2026-08-15 UI pass, medium) — the backend schema
  // (`eval_suite.costBudgetUsd`/`latencyBudgetMs`) already supports these; this form
  // just never surfaced them.
  const [costBudgetUsd, setCostBudgetUsd] = useState("");
  const [latencyBudgetMs, setLatencyBudgetMs] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const result = await fetchJson<{ suites: EvalSuiteItem[] }>("/api/v1/admin/agent-platform/eval-suites");
    if (result.kind === "ok") setSuites(result.data.suites);
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate() {
    setSubmitting(true);
    await fetchJson("/api/v1/admin/agent-platform/eval-suites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        description: description || undefined,
        passThresholdPct: passThreshold,
        costBudgetUsd: costBudgetUsd || undefined,
        latencyBudgetMs: latencyBudgetMs ? Number(latencyBudgetMs) : undefined,
      }),
    });
    setSubmitting(false);
    setIsOpen(false);
    setName("");
    setDescription("");
    setCostBudgetUsd("");
    setLatencyBudgetMs("");
    await load();
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">Eval Suites</h1>
        {canWrite && <Button onClick={() => setIsOpen(true)}>+ New Eval Suite</Button>}
      </div>

      {suites === null ? (
        <Skeleton className="h-[120px] w-full" role="status" aria-label="Loading eval suites" />
      ) : suites.length === 0 ? (
        <p className="text-muted-foreground">No eval suites yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Pass threshold</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {suites.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <NextLink href={`/agent-platform/evals/${s.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                    {s.name}
                  </NextLink>
                </TableCell>
                <TableCell>{s.description ?? "—"}</TableCell>
                <TableCell>{Number(s.passThresholdPct).toFixed(0)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={isOpen} onOpenChange={(open) => !open && setIsOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Eval Suite</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <div>
              <div className="mb-1 flex items-center gap-1">
                <Label htmlFor="new-eval-suite-name" className="font-bold">
                  Name
                </Label>
                <FieldHint
                  id="new-eval-suite-name-hint"
                  content="Shown wherever this suite is referenced — the Eval Suites list and the dropdown a version's Eval tab uses to bind a suite to that version."
                />
              </div>
              <Input id="new-eval-suite-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1">
                <Label htmlFor="new-eval-suite-description" className="font-bold">
                  Description
                </Label>
                <FieldHint
                  id="new-eval-suite-description-hint"
                  content="Optional context shown alongside the suite in the Eval Suites list — purely descriptive, not evaluated when the suite runs."
                />
              </div>
              <Input id="new-eval-suite-description" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1">
                <Label htmlFor="new-eval-suite-pass-threshold" className="font-bold">
                  Pass threshold %
                </Label>
                <FieldHint
                  id="new-eval-suite-pass-threshold-hint"
                  content="The minimum percentage of cases that must pass for a run of this suite to be marked Passed — this is the actual bar a version's promotion gate checks against, not just a display figure."
                />
              </div>
              <Input
                id="new-eval-suite-pass-threshold"
                type="number"
                min={0}
                max={100}
                value={passThreshold}
                onChange={(e) => setPassThreshold(Number(e.target.value))}
              />
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1">
                <Label htmlFor="new-eval-suite-cost-budget" className="font-bold">
                  Cost budget (USD)
                </Label>
                <FieldHint
                  id="new-eval-suite-cost-budget-hint"
                  content="Stored on the suite for reference alongside its runs — not yet enforced against a run's actual cost, so exceeding it doesn't currently affect a run's pass/fail outcome."
                />
              </div>
              <Input
                id="new-eval-suite-cost-budget"
                value={costBudgetUsd}
                onChange={(e) => setCostBudgetUsd(e.target.value)}
                placeholder="e.g. 5.00 (optional)"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1">
                <Label htmlFor="new-eval-suite-latency-budget" className="font-bold">
                  Latency budget (ms)
                </Label>
                <FieldHint
                  id="new-eval-suite-latency-budget-hint"
                  content="Stored on the suite for reference alongside its runs — not yet enforced against a run's actual p95 latency, so exceeding it doesn't currently affect a run's pass/fail outcome."
                />
              </div>
              <Input
                id="new-eval-suite-latency-budget"
                type="number"
                min={0}
                value={latencyBudgetMs}
                onChange={(e) => setLatencyBudgetMs(e.target.value)}
                placeholder="e.g. 6000 (optional)"
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={submitting || !name.trim()}>
              {submitting ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
