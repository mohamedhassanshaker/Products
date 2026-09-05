"use client";

import { useEffect, useState } from "react";
import { AccessDeniedState } from "@nextbot/ui";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Checkbox } from "@nextbot/ui/components/ui/checkbox";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import type { PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";

interface AgentQueue {
  id: string;
  name: string;
  isDefault: boolean;
  queueExternalRef: string | null;
}

interface RoutingRule {
  id: string;
  ordinal: number;
  conditions: { recognizedGoal?: string; channelTypes?: string[]; reasons?: string[]; language?: string };
  queueId: string;
  enabled: boolean;
}

const REASON_OPTIONS = ["LowConfidence", "ToolFailure", "CustomerRequest", "SensitiveTopic"];
// QA fix (D4): B.5.3 specifies "goal + channel -> queue"; the data model
// (`RoutingRule.conditions.channelTypes`) already supports this — only the rule
// editor UI was missing the Channel condition.
const CHANNEL_OPTIONS = ["WebWidget", "WhatsApp", "Messenger", "Instagram", "Voice", "Email", "Sms", "Slack", "Teams"];

/** Sentinel used by the "Any" options in the Reason/Channel selects — Base UI's
 * `Select.Item` requires a non-empty comparable value (unlike a native
 * `<option value="">`), so `""` is mapped to/from this literal at the edges. */
const ANY_VALUE = "__any__";

/**
 * B.5.3 Escalation Routing Config — the rules table (`IF recognized goal = X AND
 * channel = Y -> route to queue Z`), backend queue mapping, and the required
 * fallback (the tenant's `agent_queue.is_default` row, always shown, never editable
 * to "none" — FR-ESC-03's "routing must never leave an escalation unassigned").
 */
export function RoutingConfig({ permissionLevel }: { permissionLevel: PermissionLevelValue }) {
  const [queues, setQueues] = useState<AgentQueue[] | null>(null);
  const [rules, setRules] = useState<RoutingRule[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newQueueName, setNewQueueName] = useState("");
  const canEdit = permissionLevel === "Write";

  async function reload() {
    setError(null);
    const [queuesResult, rulesResult] = await Promise.all([
      fetchJson<{ queues: AgentQueue[] }>("/api/v1/admin/escalation-queues"),
      fetchJson<{ rules: RoutingRule[] }>("/api/v1/admin/escalation-routing-rules"),
    ]);
    if (queuesResult.kind === "forbidden" || rulesResult.kind === "forbidden") {
      setForbidden(true);
      return;
    }
    if (queuesResult.kind === "ok") setQueues(queuesResult.data.queues);
    if (rulesResult.kind === "ok") setRules(rulesResult.data.rules);
  }

  useEffect(() => {
    void reload();
  }, []);

  const defaultQueue = queues?.find((q) => q.isDefault) ?? null;

  function addRule() {
    if (!queues || queues.length === 0) return;
    setRules((prev) => [...(prev ?? []), { id: crypto.randomUUID(), ordinal: (prev?.length ?? 0) + 1, conditions: {}, queueId: queues[0]!.id, enabled: true }]);
  }

  function updateRule(id: string, patch: Partial<RoutingRule>) {
    setRules((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRule(id: string) {
    setRules((prev) => (prev ?? []).filter((r) => r.id !== id));
  }

  async function saveRules() {
    if (!rules) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/escalation-routing-rules", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rules: rules.map((r) => ({ conditions: r.conditions, queueId: r.queueId, enabled: r.enabled })) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.title ?? "Could not save routing rules.");
        return;
      }
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function createQueue() {
    if (!newQueueName.trim()) return;
    const res = await fetch("/api/v1/admin/escalation-queues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newQueueName }),
    });
    if (res.ok) {
      setNewQueueName("");
      await reload();
    }
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Escalation Routing" />;
  if (!queues || !rules)
    return (
      <div className="p-6">
        {/* axe-core's `page-has-heading-one` rule (Batch A a11y audit): this
            loading return replaces the whole page, including the real `h1`
            below — a screen-reader-only duplicate keeps a level-one heading
            present the whole time, not just once data has loaded. */}
        <h1 className="sr-only">Escalation Routing</h1>
        <Skeleton className="h-48 w-full" role="status" aria-label="Loading escalation routing" />
      </div>
    );

  return (
    <div className="p-6">
      <h1 className="mb-4 font-heading text-lg font-semibold">Escalation Routing</h1>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mb-6">
        <h2 className="mb-2 font-heading text-sm font-semibold">Fallback queue (required, never unassigned)</h2>
        <p className="text-sm">
          {defaultQueue ? defaultQueue.name : "A default queue will be created automatically the first time it's needed."}
        </p>
      </div>

      <div className="mb-6">
        <h2 className="mb-2 font-heading text-sm font-semibold">Backend queue mapping</h2>
        <Table className="mb-2">
          <TableHeader>
            <TableRow>
              <TableHead>Queue</TableHead>
              <TableHead>Backend reference</TableHead>
              <TableHead>Default</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {queues.map((q) => (
              <TableRow key={q.id}>
                <TableCell>{q.name}</TableCell>
                <TableCell>{q.queueExternalRef ?? "—"}</TableCell>
                <TableCell>{q.isDefault ? "Yes" : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Label htmlFor="new-queue-name" className="sr-only">
              New queue name
            </Label>
            <FieldHint
              id="new-queue-name-hint"
              content="A name for a new backend queue in this tenant's escalation routing — map rules to it below once created."
            />
            <Input
              id="new-queue-name"
              placeholder="New queue name"
              value={newQueueName}
              onChange={(e) => setNewQueueName(e.target.value)}
              className="h-7 max-w-[240px]"
            />
            <Button size="sm" onClick={createQueue}>
              Add Queue
            </Button>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 font-heading text-sm font-semibold">Rules (first match wins)</h2>
        <div className="mb-3 flex flex-col items-stretch gap-2">
          {rules.map((rule) => (
            <div key={rule.id} className="flex flex-wrap items-center gap-2 rounded-none border p-2">
              <Label htmlFor={`rule-goal-${rule.id}`} className="text-xs">
                Goal
              </Label>
              <FieldHint
                id={`rule-goal-${rule.id}-hint`}
                content="Matches the AI's recognized conversation goal from NLU classification — leave blank to match any goal."
              />
              <Input
                id={`rule-goal-${rule.id}`}
                className="h-7 max-w-[140px]"
                value={rule.conditions.recognizedGoal ?? ""}
                onChange={(e) => updateRule(rule.id, { conditions: { ...rule.conditions, recognizedGoal: e.target.value || undefined } })}
                disabled={!canEdit}
              />
              <Label htmlFor={`rule-reason-${rule.id}`} className="text-xs">
                Reason
              </Label>
              <FieldHint
                id={`rule-reason-${rule.id}-hint`}
                content="Matches the specific escalation trigger reason (e.g. low confidence, tool failure) — Any matches regardless of reason."
              />
              <Select
                value={rule.conditions.reasons?.[0] ?? ANY_VALUE}
                onValueChange={(v) =>
                  updateRule(rule.id, { conditions: { ...rule.conditions, reasons: v === ANY_VALUE ? undefined : [v as string] } })
                }
                disabled={!canEdit}
              >
                <SelectTrigger id={`rule-reason-${rule.id}`} className="h-7 w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_VALUE}>Any</SelectItem>
                  {REASON_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label htmlFor={`rule-channel-${rule.id}`} className="text-xs">
                Channel
              </Label>
              <FieldHint
                id={`rule-channel-${rule.id}-hint`}
                content="Matches which channel the conversation came in on (web widget, WhatsApp, etc.) — Any matches every channel."
              />
              <Select
                value={rule.conditions.channelTypes?.[0] ?? ANY_VALUE}
                onValueChange={(v) =>
                  updateRule(rule.id, { conditions: { ...rule.conditions, channelTypes: v === ANY_VALUE ? undefined : [v as string] } })
                }
                disabled={!canEdit}
              >
                <SelectTrigger id={`rule-channel-${rule.id}`} aria-label="Channel condition" className="h-7 w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_VALUE}>Any</SelectItem>
                  {CHANNEL_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label htmlFor={`rule-queue-${rule.id}`} className="text-xs">
                Queue
              </Label>
              <FieldHint
                id={`rule-queue-${rule.id}-hint`}
                content="Which backend queue (mapped above) this rule routes a matching escalation to."
              />
              <Select value={rule.queueId} onValueChange={(v) => updateRule(rule.id, { queueId: v as string })} disabled={!canEdit}>
                <SelectTrigger id={`rule-queue-${rule.id}`} className="h-7 w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {queues.map((q) => (
                    <SelectItem key={q.id} value={q.id}>
                      {q.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Checkbox
                id={`rule-enabled-${rule.id}`}
                checked={rule.enabled}
                onCheckedChange={(checked) => updateRule(rule.id, { enabled: checked === true })}
                disabled={!canEdit}
              />
              <Label htmlFor={`rule-enabled-${rule.id}`} className="flex items-center gap-2 text-xs">
                Enabled
              </Label>
              <FieldHint
                id={`rule-enabled-${rule.id}-hint`}
                content="When off, this rule is skipped during matching (first-match-wins) without being deleted — useful for temporarily disabling a rule."
              />
              {canEdit && (
                <Button size="xs" variant="ghost" className="text-destructive" onClick={() => removeRule(rule.id)}>
                  Remove
                </Button>
              )}
            </div>
          ))}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={addRule} disabled={queues.length === 0}>
              Add Rule
            </Button>
            <Button size="sm" onClick={saveRules} disabled={saving}>
              Save
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
