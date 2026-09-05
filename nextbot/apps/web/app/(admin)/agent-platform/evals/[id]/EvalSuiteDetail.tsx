"use client";

import { useEffect, useState } from "react";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@nextbot/ui/components/ui/dialog";
import { fetchJson } from "@/src/lib/fetch-json";

interface TranscriptTurn {
  sender: "Customer" | "AI";
  text: string;
}

interface EvalCaseItem {
  id: string;
  name: string;
  inputTranscript: TranscriptTurn[];
  expectedToolCalls: Array<{ toolName: string }> | null;
  expectedResponsePattern: string | null;
}

/** BL-07 Eval Suite Detail — case list + add-case form (UX_GUIDELINES.md §6.5). */
export function EvalSuiteDetail({ suiteId, canWrite }: { suiteId: string; canWrite: boolean }) {
  const [cases, setCases] = useState<EvalCaseItem[] | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([{ sender: "Customer", text: "" }]);
  const [expectedPattern, setExpectedPattern] = useState("");
  const [toolCalls, setToolCalls] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const result = await fetchJson<{ cases: EvalCaseItem[] }>(`/api/v1/admin/agent-platform/eval-suites/${suiteId}/cases`);
    if (result.kind === "ok") setCases(result.data.cases);
  }

  useEffect(() => {
    void load();
  }, [suiteId]);

  const toolCallCaseCount = cases?.filter((c) => c.expectedToolCalls && c.expectedToolCalls.length > 0).length ?? 0;

  async function handleCreate() {
    setSubmitting(true);
    await fetchJson(`/api/v1/admin/agent-platform/eval-suites/${suiteId}/cases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        inputTranscript: transcript.filter((t) => t.text.trim()),
        expectedResponsePattern: expectedPattern || undefined,
        expectedToolCalls: toolCalls.filter(Boolean).map((toolName) => ({ toolName })) || undefined,
      }),
    });
    setSubmitting(false);
    setIsOpen(false);
    setName("");
    setTranscript([{ sender: "Customer", text: "" }]);
    setExpectedPattern("");
    setToolCalls([]);
    await load();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">Eval Suite Cases</h1>
        {canWrite && <Button onClick={() => setIsOpen(true)}>+ Add Case</Button>}
      </div>

      {toolCallCaseCount > 0 && (
        <Alert variant="warning" className="mb-4">
          <AlertDescription>
            {toolCallCaseCount} of {cases?.length} cases in this suite assert tool calls, which can&apos;t pass until a later phase ships — this
            suite can&apos;t reach 100% until then. Consider a lower threshold or a separate suite without these cases for now.
          </AlertDescription>
        </Alert>
      )}

      {cases === null ? (
        <Skeleton className="h-[120px] w-full" role="status" aria-label="Loading eval suite cases" />
      ) : cases.length === 0 ? (
        <p className="text-muted-foreground">No test cases yet — add one to start gating promotions.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Input preview</TableHead>
              <TableHead>Expected</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cases.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.name}</TableCell>
                <TableCell>
                  <span className="block max-w-[280px] truncate">{c.inputTranscript.map((t) => t.text).join(" / ")}</span>
                </TableCell>
                <TableCell>
                  {c.expectedToolCalls && c.expectedToolCalls.length > 0 ? (
                    <span className="text-muted-foreground">Tool call(s) — not yet supported</span>
                  ) : c.expectedResponsePattern ? (
                    <code>{c.expectedResponsePattern}</code>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={isOpen} onOpenChange={(open) => !open && setIsOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Eval Case</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <div>
              <div className="mb-1 flex items-center gap-1">
                <Label htmlFor="add-eval-case-name" className="font-bold">
                  Name
                </Label>
                <FieldHint
                  id="add-eval-case-name-hint"
                  content="Identifies this case in the suite's case list and in a run's per-case results breakdown — has no effect on how the case is evaluated."
                />
              </div>
              <Input id="add-eval-case-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>

            <div>
              <p className="mb-1 font-bold">Input transcript</p>
              <div className="flex flex-col gap-2">
                {transcript.map((turn, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Select
                      value={turn.sender}
                      onValueChange={(v) => {
                        const next = [...transcript];
                        next[idx] = { ...turn, sender: v as "Customer" | "AI" };
                        setTranscript(next);
                      }}
                    >
                      <SelectTrigger className="w-[140px]" aria-label={`Sender for turn ${idx + 1}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Customer">Customer</SelectItem>
                        <SelectItem value="AI">AI</SelectItem>
                      </SelectContent>
                    </Select>
                    <Textarea
                      value={turn.text}
                      onChange={(e) => {
                        const next = [...transcript];
                        next[idx] = { ...turn, text: e.target.value };
                        setTranscript(next);
                      }}
                      rows={1}
                      aria-label={`Turn ${idx + 1} text`}
                      className="min-h-8"
                    />
                    <Button
                      aria-label={`Remove turn ${idx + 1}`}
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setTranscript(transcript.filter((_, i) => i !== idx))}
                      disabled={transcript.length === 1}
                    >
                      ×
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  onClick={() => setTranscript([...transcript, { sender: "Customer", text: "" }])}
                >
                  + Add turn
                </Button>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center gap-1">
                <Label htmlFor="add-eval-case-expected-pattern" className="font-bold">
                  Expected response pattern
                </Label>
                <FieldHint
                  id="add-eval-case-expected-pattern-hint"
                  content="A case-insensitive regular expression checked against the agent's final response text — leave blank for a case that only asserts tool calls (not yet evaluated) or that has no pass/fail assertion at all."
                />
              </div>
              <Input
                id="add-eval-case-expected-pattern"
                value={expectedPattern}
                onChange={(e) => setExpectedPattern(e.target.value)}
                placeholder=".*order.*"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Matched as a case-insensitive regular expression against the agent&apos;s final response text.
              </p>
            </div>

            <div>
              <p className="mb-1 font-bold">Expected tool calls (optional)</p>
              <div className="flex flex-col gap-2">
                {toolCalls.map((tc, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      value={tc}
                      onChange={(e) => {
                        const next = [...toolCalls];
                        next[idx] = e.target.value;
                        setToolCalls(next);
                      }}
                      placeholder="tool_name"
                      aria-label={`Expected tool call ${idx + 1}`}
                    />
                    <Button
                      aria-label={`Remove expected tool call ${idx + 1}`}
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setToolCalls(toolCalls.filter((_, i) => i !== idx))}
                    >
                      ×
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" className="self-start" onClick={() => setToolCalls([...toolCalls, ""])}>
                  + Add expected tool call
                </Button>
              </div>
              <Alert className="mt-2">
                <AlertDescription>
                  Tool-call assertions can&apos;t be evaluated until a later phase — cases with these will always show as &quot;not yet
                  supported,&quot; not pass or fail on their actual behavior.
                </AlertDescription>
              </Alert>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={submitting || !name.trim()}>
              {submitting ? "Adding…" : "Add Case"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
