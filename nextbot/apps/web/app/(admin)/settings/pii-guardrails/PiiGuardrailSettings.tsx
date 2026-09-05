"use client";

import { useEffect, useState } from "react";
import { AccessDeniedState } from "@nextbot/ui";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import type { PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";

interface PiiRule {
  id: string;
  entityType: string;
  label: string;
  pattern: string | null;
  enabled: boolean;
}
interface GuardrailRule {
  id: string;
  name: string;
  ordinal: number;
  conditions: { toolName?: string };
  effect: "BlockToolCall" | "EscalateToHuman";
  reason: string;
  enabled: boolean;
}

const ENTITY_TYPES = ["NationalId", "CreditCard", "IBAN", "Phone", "Email", "Passport", "DateOfBirth", "Custom"];
const CONTEXTS = ["Transcript", "ToolCallPayload", "A2APayload", "Export", "HumanAgentView"];
const TRUST_LEVELS = ["Trusted", "SemiTrusted", "Untrusted"];
const ACTIONS = ["Show", "PartialMask", "FullMask", "Redact"];

/**
 * FR-SEC-04's PII detection-rule + masking-context-matrix authoring, and the full
 * guardrail authoring UI superseding Phase 12's stub. One page, two sections —
 * both are small, closely-related "policy table" surfaces (same UX pattern as
 * B.5.3's routing rules table), not separate screens per nexus-ux's baseline for
 * routine admin CRUD.
 */
export function PiiGuardrailSettings({ permissionLevel }: { permissionLevel: PermissionLevelValue }) {
  const canEdit = permissionLevel === "Write";
  const [rules, setRules] = useState<PiiRule[] | null>(null);
  const [guardrails, setGuardrails] = useState<GuardrailRule[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newLabel, setNewLabel] = useState("");
  const [newEntityType, setNewEntityType] = useState("Custom");
  const [newPattern, setNewPattern] = useState("");

  const [policyEntity, setPolicyEntity] = useState(ENTITY_TYPES[0]!);
  const [policyContext, setPolicyContext] = useState(CONTEXTS[0]!);
  const [policyTrust, setPolicyTrust] = useState(TRUST_LEVELS[0]!);
  const [policyAction, setPolicyAction] = useState(ACTIONS[2]!);

  const [grName, setGrName] = useState("");
  const [grToolName, setGrToolName] = useState("");
  const [grEffect, setGrEffect] = useState<"BlockToolCall" | "EscalateToHuman">("BlockToolCall");
  const [grReason, setGrReason] = useState("");

  async function reload() {
    setError(null);
    const [rulesResult, guardrailResult] = await Promise.all([
      fetchJson<{ rules: PiiRule[] }>("/api/v1/admin/pii-rules"),
      fetchJson<{ rules: GuardrailRule[] }>("/api/v1/admin/guardrail-rules"),
    ]);
    if (rulesResult.kind === "forbidden" || guardrailResult.kind === "forbidden") return setForbidden(true);
    if (rulesResult.kind === "ok") setRules(rulesResult.data.rules);
    if (guardrailResult.kind === "ok") setGuardrails(guardrailResult.data.rules);
  }

  useEffect(() => {
    // Deliberately empty deps — runs once on mount only.
    void reload();
  }, []);

  async function addPiiRule() {
    const result = await fetchJson("/api/v1/admin/pii-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: newEntityType, label: newLabel, pattern: newPattern || undefined, enabled: true }),
    });
    if (result.kind === "error") return setError(result.message);
    setNewLabel("");
    setNewPattern("");
    await reload();
  }

  async function savePolicy() {
    const result = await fetchJson("/api/v1/admin/pii-policies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: policyEntity, context: policyContext, trustLevel: policyTrust, action: policyAction }),
    });
    if (result.kind === "error") return setError(result.message);
  }

  async function addGuardrail() {
    const ordinal = (guardrails?.length ?? 0) + 1;
    const result = await fetchJson("/api/v1/admin/guardrail-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: grName, ordinal, conditions: { toolName: grToolName }, effect: grEffect, reason: grReason, enabled: true }),
    });
    if (result.kind === "error") return setError(result.message);
    setGrName("");
    setGrToolName("");
    setGrReason("");
    await reload();
  }

  if (forbidden) return <AccessDeniedState moduleLabel="PII & Guardrails" />;

  return (
    <div className="p-6">
      <h1 className="mb-4 font-heading text-lg font-semibold">PII Detection, Masking & Guardrails</h1>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <h2 className="mb-2 font-heading text-sm font-semibold">Detection rules</h2>
      {rules === null ? (
        <Skeleton className="mb-4 h-24 w-full" role="status" aria-label="Loading detection rules" />
      ) : (
        <Table className="mb-4">
          <TableHeader>
            <TableRow>
              <TableHead>Entity type</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Pattern</TableHead>
              <TableHead>Enabled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.entityType}</TableCell>
                <TableCell>{r.label}</TableCell>
                <TableCell>{r.pattern ?? "(built-in)"}</TableCell>
                <TableCell>{r.enabled ? "Yes" : "No"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {canEdit && (
        <div className="mb-6 flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Label htmlFor="pii-new-entity-type">Entity type</Label>
              <FieldHint
                id="pii-new-entity-type-hint"
                content="Which category of PII this detection rule matches — choose Custom to define your own regex pattern below instead of one of the built-in detectors."
              />
            </div>
            <Select value={newEntityType} onValueChange={(v) => setNewEntityType(v as string)}>
              <SelectTrigger id="pii-new-entity-type" className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Label htmlFor="pii-new-label">Label</Label>
              <FieldHint
                id="pii-new-label-hint"
                content="The display name shown for this rule wherever detected PII is referenced (e.g. the masking-context matrix and audit log) — distinct from the entity type itself."
              />
            </div>
            <Input id="pii-new-label" placeholder="Label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} className="max-w-[180px]" />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Label htmlFor="pii-new-pattern">Custom regex (Custom type only)</Label>
              <FieldHint
                id="pii-new-pattern-hint"
                content="A custom regex used to detect this entity in text — only read when Entity type is Custom; built-in entity types use their own detector instead."
              />
            </div>
            <Input
              id="pii-new-pattern"
              placeholder="Custom regex (Custom type only)"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              className="max-w-[260px]"
            />
          </div>
          <Button onClick={() => void addPiiRule()}>Add rule</Button>
        </div>
      )}

      <h2 className="mb-2 font-heading text-sm font-semibold">Masking-context matrix</h2>
      <p className="mb-2 text-sm text-muted-foreground">Unconfigured combinations default to FullMask (fail closed).</p>
      {canEdit && (
        <div className="mb-6 flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Label htmlFor="pii-policy-entity">Entity type</Label>
              <FieldHint
                id="pii-policy-entity-hint"
                content="Which PII entity type this masking-context matrix cell applies to."
              />
            </div>
            <Select value={policyEntity} onValueChange={(v) => setPolicyEntity(v as string)}>
              <SelectTrigger id="pii-policy-entity" className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Label htmlFor="pii-policy-context">Context</Label>
              <FieldHint
                id="pii-policy-context-hint"
                content="Where in the system this masking rule applies (e.g. transcripts, tool call payloads, exports) — the same entity can be masked differently per context."
              />
            </div>
            <Select value={policyContext} onValueChange={(v) => setPolicyContext(v as string)}>
              <SelectTrigger id="pii-policy-context" className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTEXTS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Label htmlFor="pii-policy-trust">Trust level</Label>
              <FieldHint
                id="pii-policy-trust-hint"
                content="The trust level of whoever's viewing the data — an Untrusted viewer can be masked more aggressively than a Trusted one for the same entity/context."
              />
            </div>
            <Select value={policyTrust} onValueChange={(v) => setPolicyTrust(v as string)}>
              <SelectTrigger id="pii-policy-trust" className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRUST_LEVELS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Label htmlFor="pii-policy-action">Action</Label>
              <FieldHint
                id="pii-policy-action-hint"
                content="What happens to a detected entity for this entity/context/trust combination — an unconfigured combination defaults to Full Mask (fail closed)."
              />
            </div>
            <Select value={policyAction} onValueChange={(v) => setPolicyAction(v as string)}>
              <SelectTrigger id="pii-policy-action" className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIONS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => void savePolicy()}>Save policy cell</Button>
        </div>
      )}

      <h2 className="mb-2 font-heading text-sm font-semibold">Guardrails (pre-tool-call)</h2>
      {guardrails === null ? (
        <Skeleton className="mb-4 h-24 w-full" role="status" aria-label="Loading guardrails" />
      ) : (
        <Table className="mb-4">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Tool</TableHead>
              <TableHead>Effect</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {guardrails.map((g) => (
              <TableRow key={g.id}>
                <TableCell>{g.name}</TableCell>
                <TableCell>{g.conditions.toolName}</TableCell>
                <TableCell>{g.effect}</TableCell>
                <TableCell>{g.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Label htmlFor="pii-guardrail-name">Name</Label>
              <FieldHint
                id="pii-guardrail-name-hint"
                content="An internal identifier for this guardrail rule, shown in the rules table and audit log — has no effect on which tool calls it matches."
              />
            </div>
            <Input id="pii-guardrail-name" placeholder="Name" value={grName} onChange={(e) => setGrName(e.target.value)} className="max-w-[160px]" />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Label htmlFor="pii-guardrail-tool">Tool name</Label>
              <FieldHint
                id="pii-guardrail-tool-hint"
                content="The exact tool name this guardrail's condition matches against — the rule only fires for calls to this tool."
              />
            </div>
            <Input
              id="pii-guardrail-tool"
              placeholder="Tool name"
              value={grToolName}
              onChange={(e) => setGrToolName(e.target.value)}
              className="max-w-[160px]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Label htmlFor="pii-guardrail-effect">Effect</Label>
              <FieldHint
                id="pii-guardrail-effect-hint"
                content="What happens when this guardrail's condition matches: Block tool call stops the call before it runs; Escalate to human hands the conversation to a human agent instead."
              />
            </div>
            <Select value={grEffect} onValueChange={(v) => setGrEffect(v as "BlockToolCall" | "EscalateToHuman")}>
              <SelectTrigger id="pii-guardrail-effect" className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BlockToolCall">Block tool call</SelectItem>
                <SelectItem value="EscalateToHuman">Escalate to human</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Label htmlFor="pii-guardrail-reason">Reason</Label>
              <FieldHint
                id="pii-guardrail-reason-hint"
                content="Shown to the agent/admin when this guardrail fires — explains why the tool call was blocked or escalated."
              />
            </div>
            <Input
              id="pii-guardrail-reason"
              placeholder="Reason"
              value={grReason}
              onChange={(e) => setGrReason(e.target.value)}
              className="max-w-[220px]"
            />
          </div>
          <Button onClick={() => void addGuardrail()}>Add guardrail</Button>
        </div>
      )}
    </div>
  );
}
