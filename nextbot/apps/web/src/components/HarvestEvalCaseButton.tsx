"use client";

import { useEffect, useState } from "react";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Card } from "@nextbot/ui/components/ui/card";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { toast } from "@nextbot/ui/lib/toast";
import { fetchJson } from "@/src/lib/fetch-json";

interface EvalSuiteOption {
  id: string;
  name: string;
}

/**
 * Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-16, LLD §14.9.3) — one
 * action from a conversation/escalation/denied-Tier-3-approval detail view
 * promotes it into an eval case. Reused verbatim across all three detail
 * views (only `source`/`sourceRef`/the pre-filled transcript differ per call
 * site) — a single admin-confirmation dialog, never an auto-add.
 */
export function HarvestEvalCaseButton({
  source,
  sourceRef,
  defaultName,
  transcript,
}: {
  source: "HarvestedConversation" | "HarvestedEscalation" | "HarvestedApprovalDenial";
  sourceRef: string;
  defaultName: string;
  transcript: Array<{ sender: string; text: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [suites, setSuites] = useState<EvalSuiteOption[]>([]);
  const [evalSuiteId, setEvalSuiteId] = useState("");
  const [name, setName] = useState(defaultName);
  const [expectedResponsePattern, setExpectedResponsePattern] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const result = await fetchJson<{ suites: EvalSuiteOption[] }>("/api/v1/admin/agent-platform/eval-suites");
      if (result.kind === "ok") {
        setSuites(result.data.suites);
        if (result.data.suites[0]) setEvalSuiteId(result.data.suites[0].id);
      }
    })();
  }, [open]);

  async function handleConfirm() {
    if (!evalSuiteId) {
      setError("Choose an eval suite to add this case to.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await fetchJson("/api/v1/admin/agent-platform/eval-cases/harvest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        evalSuiteId,
        source,
        sourceRef,
        name,
        inputTranscript: transcript,
        expectedResponsePattern: expectedResponsePattern || undefined,
      }),
    });
    setBusy(false);
    if (result.kind !== "ok") {
      setError(result.message);
      return;
    }
    toast.success("Added to the eval suite.");
    setOpen(false);
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Promote to eval case
      </Button>
    );
  }

  return (
    <Card className="flex max-w-md flex-col gap-3 p-4">
      <p className="text-sm font-medium">Promote to eval case</p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div>
        <label className="text-sm">Eval suite</label>
        <Select value={evalSuiteId} onValueChange={(v) => v !== null && setEvalSuiteId(v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {suites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-sm">Case name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="text-sm">Expected response pattern (optional)</label>
        <Input value={expectedResponsePattern} onChange={(e) => setExpectedResponsePattern(e.target.value)} placeholder="regex, e.g. refund" />
      </div>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => void handleConfirm()}>{busy ? "Adding…" : "Confirm"}</Button>
        <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </Card>
  );
}
