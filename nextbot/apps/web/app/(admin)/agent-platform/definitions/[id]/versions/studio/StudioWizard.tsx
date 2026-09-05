"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { Checkbox } from "@nextbot/ui/components/ui/checkbox";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Card } from "@nextbot/ui/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { fetchJson } from "@/src/lib/fetch-json";
import { GRAPH_TYPES, ROUTE_KEYS } from "../new/version-editor-constants";

const STEP_LABELS = [
  "Purpose & persona",
  "Audience & channel",
  "Skills",
  "Tools",
  "Knowledge",
  "Guardrails & escalation",
  "Model & budgets",
  "Memory",
  "Evals",
  "Review",
];

const TRUST_LEVELS = ["Trusted", "SemiTrusted", "Untrusted"] as const;
const CHANNEL_TYPES = ["WebWidget", "WhatsApp", "Messenger", "Instagram", "Voice", "Email", "Sms", "Slack", "Teams"] as const;
const PII_CONTEXTS = ["Transcript", "ToolCallPayload", "A2APayload", "Export", "HumanAgentView", "Knowledge"] as const;
const MASK_ACTIONS = ["Show", "PartialMask", "FullMask", "Redact"] as const;
const ESCALATION_REASONS = ["LowConfidence", "ToolFailure", "CustomerRequest", "SensitiveTopic"];

interface AvailableEvalCase {
  id: string;
  name: string;
  skillName: string;
}

/**
 * Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-13, LLD §14.5.5) — the
 * Agent Design Studio's nine-step wizard. Mirrors `McpEnrolmentWizard.tsx`'s
 * own established shape exactly (a single-page, section-by-section client
 * component; the SERVER is authoritative and resumable — every "Continue"
 * click POSTs that step's slice to `/api/v1/admin/agent-platform/studio/
 * drafts/{id}/**` and only advances the local step on a real 2xx response) —
 * no separate `nexus-ux` dispatch for this screen: the wizard-of-steps pattern
 * is already established in this exact console (the MCP enrolment wizard), so
 * this reuses that documented pattern rather than re-deriving it.
 *
 * The Review step's YAML preview and the final submit both go through the
 * SAME server-side `composeArtifactFromDraft`/`createAgentDefinitionVersion`
 * path Text/Design mode use — "what you previewed is what you saved" holds by
 * construction, not by this component's own care.
 */
export function StudioWizard({ definitionId }: { definitionId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-15) — a blueprint's
  // "instantiate" action (`instantiateBlueprintAsDraft`) creates a real
  // `studio_draft` already pre-populated all the way to Review; linking here
  // with `?draftId=<that draft's id>` resumes it directly at Review instead of
  // creating a brand-new blank draft, editable before save exactly like any
  // other Studio draft.
  const existingDraftId = searchParams.get("draftId");
  const [definitionName, setDefinitionName] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — Purpose & persona
  const [instructions, setInstructions] = useState("You are a helpful support agent.");

  // Step 2 — Audience & channel
  const [trustLevel, setTrustLevel] = useState<(typeof TRUST_LEVELS)[number]>("SemiTrusted");
  const [channelTypes, setChannelTypes] = useState<Record<string, boolean>>({});

  // Step 3 — Skills
  const [skillPinsText, setSkillPinsText] = useState("");

  // Step 4 — Tools
  const [capabilityGroupsText, setCapabilityGroupsText] = useState("");
  const [maxToolCallsPerTurn, setMaxToolCallsPerTurn] = useState(5);

  // Step 5 — Knowledge (kept minimal — a knowledge-scoped version is opt-in)
  const [knowledgeEnabled, setKnowledgeEnabled] = useState(false);
  const [knowledgeCollectionsText, setKnowledgeCollectionsText] = useState("");
  const [refuseWhenUngrounded, setRefuseWhenUngrounded] = useState(true);
  const [minCitations, setMinCitations] = useState(1);

  // Step 6 — Guardrails & escalation
  const [minConfidenceForAutonomy, setMinConfidenceForAutonomy] = useState(0.6);
  const [escalateOn, setEscalateOn] = useState<Record<string, boolean>>({ LowConfidence: true });
  const [maskingFloor, setMaskingFloor] = useState<Record<string, string>>({});

  // Step 7 — Model & budgets
  const [modelRoute, setModelRoute] = useState("chat.primary");
  const [maxCostUsdPerConversation, setMaxCostUsdPerConversation] = useState("0.50");
  const [maxLatencyMsP95, setMaxLatencyMsP95] = useState(6000);

  // Step 8 — Memory
  const [maxTurns, setMaxTurns] = useState(20);

  // Step 9 — Evals
  const [availableCases, setAvailableCases] = useState<AvailableEvalCase[]>([]);
  const [includedCaseIds, setIncludedCaseIds] = useState<Record<string, boolean>>({});

  // Step 10 — Review
  const [version, setVersion] = useState("0.1.0");
  const [graphType, setGraphType] = useState("ADK");
  const [modelRouteKey, setModelRouteKey] = useState("chat.primary");
  const [previewYaml, setPreviewYaml] = useState("");
  const [previewArtifact, setPreviewArtifact] = useState<unknown>(null);
  const [createdVersionId, setCreatedVersionId] = useState<string | null>(null);
  const [blueprintSaved, setBlueprintSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      const defResult = await fetchJson<{ definition: { name: string } }>(`/api/v1/admin/agent-platform/definitions/${definitionId}`);
      if (defResult.kind === "ok") setDefinitionName(defResult.data.definition.name);

      if (existingDraftId) {
        const draftResult = await fetchJson<{ draft: { id: string; step: number } }>(`/api/v1/admin/agent-platform/studio/drafts/${existingDraftId}`);
        if (draftResult.kind === "ok") {
          setDraftId(draftResult.data.draft.id);
          setStep(draftResult.data.draft.step);
          if (draftResult.data.draft.step >= 10) {
            const previewResult = await fetchJson<{ yaml: string; artifact: unknown }>(`/api/v1/admin/agent-platform/studio/drafts/${draftResult.data.draft.id}/preview`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ version, graphType }),
            });
            if (previewResult.kind === "ok") {
              setPreviewYaml(previewResult.data.yaml);
              setPreviewArtifact(previewResult.data.artifact);
            }
          }
          return;
        }
        setError(draftResult.message);
        return;
      }

      const result = await fetchJson<{ draft: { id: string } }>("/api/v1/admin/agent-platform/studio/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentDefinitionId: definitionId }),
      });
      if (result.kind === "ok") setDraftId(result.data.draft.id);
      else setError(result.message);
    })();
  }, [definitionId, existingDraftId]);

  async function postStep<T>(path: string, body: T): Promise<boolean> {
    if (!draftId) return false;
    setBusy(true);
    setError(null);
    const result = await fetchJson(`/api/v1/admin/agent-platform/studio/drafts/${draftId}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (result.kind !== "ok") {
      setError(result.message);
      return false;
    }
    return true;
  }

  async function handlePurpose() {
    if (await postStep("purpose", { instructions })) setStep(2);
  }

  async function handleAudience() {
    const selectedChannels = Object.entries(channelTypes).filter(([, v]) => v).map(([k]) => k);
    if (await postStep("audience", { trustLevel, channelTypes: selectedChannels.length > 0 ? selectedChannels : undefined })) setStep(3);
  }

  async function handleSkills() {
    const skills = skillPinsText.split(",").map((s) => s.trim()).filter(Boolean);
    if (await postStep("skills", { skills })) setStep(4);
  }

  async function handleTools() {
    const capabilityGroups = capabilityGroupsText.split(",").map((s) => s.trim()).filter(Boolean);
    if (await postStep("tools", { capabilityGroups, maxToolCallsPerTurn })) setStep(5);
  }

  async function handleKnowledge() {
    const knowledge = knowledgeEnabled
      ? {
          collections: knowledgeCollectionsText.split(",").map((s) => s.trim()).filter(Boolean),
          strategy: "auto",
          maxHops: 2,
          maxExpansions: 2,
          minCitations,
          refuseWhenUngrounded,
          budget: { usdPerTurn: 0.5, seconds: 20 },
        }
      : undefined;
    if (await postStep("knowledge", { knowledge })) setStep(6);
  }

  async function handleGuardrails() {
    const selectedEscalations = Object.entries(escalateOn).filter(([, v]) => v).map(([k]) => k);
    const cleanedMaskingFloor = Object.fromEntries(Object.entries(maskingFloor).filter(([, v]) => v));
    if (
      await postStep("guardrails", {
        minConfidenceForAutonomy,
        escalateOn: selectedEscalations,
        trustLevel,
        maskingFloor: Object.keys(cleanedMaskingFloor).length > 0 ? cleanedMaskingFloor : undefined,
      })
    )
      setStep(7);
  }

  async function handleModelBudgets() {
    if (await postStep("model-budgets", { modelRoute, maxCostUsdPerConversation, maxLatencyMsP95 })) {
      setModelRouteKey(modelRoute);
      setStep(8);
    }
  }

  async function handleEvalsStepEnter() {
    const skills = skillPinsText.split(",").map((s) => s.trim()).filter(Boolean);
    const result = await fetchJson<{ cases: AvailableEvalCase[] }>("/api/v1/admin/agent-platform/studio/available-skill-eval-cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skillPins: skills }),
    });
    if (result.kind === "ok") setAvailableCases(result.data.cases);
  }

  async function handleMemory() {
    if (await postStep("memory", { strategy: "rolling-window", maxTurns })) {
      setStep(9);
      await handleEvalsStepEnter();
    }
  }

  async function handleEvals() {
    const included = Object.entries(includedCaseIds).filter(([, v]) => v).map(([k]) => k);
    if (await postStep("evals", { includedSkillEvalCaseIds: included })) {
      setStep(10);
      const previewResult = await fetchJson<{ yaml: string; artifact: unknown }>(`/api/v1/admin/agent-platform/studio/drafts/${draftId}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version, graphType }),
      });
      if (previewResult.kind === "ok") {
        setPreviewYaml(previewResult.data.yaml);
        setPreviewArtifact(previewResult.data.artifact);
      } else setError(previewResult.message);
    }
  }

  async function handleSaveAsBlueprint() {
    if (!previewArtifact) return;
    const name = window.prompt("Name this blueprint (tenant-local, reusable within this tenant only):", `${definitionName} template`);
    if (!name) return;
    setBusy(true);
    const result = await fetchJson("/api/v1/admin/agent-platform/blueprints", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, artifact: previewArtifact }),
    });
    setBusy(false);
    if (result.kind !== "ok") {
      setError(result.message);
      return;
    }
    setBlueprintSaved(true);
  }

  async function handleSubmit() {
    if (!draftId) return;
    setBusy(true);
    setError(null);
    const result = await fetchJson<{ version: { id: string } }>(`/api/v1/admin/agent-platform/studio/drafts/${draftId}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version, graphType, modelRouteKey }),
    });
    setBusy(false);
    if (result.kind !== "ok") {
      setError(result.message);
      return;
    }
    setCreatedVersionId(result.data.version.id);
  }

  if (createdVersionId) {
    return (
      <div className="max-w-xl">
        <Alert>
          <AlertDescription>Version {version} saved as a Draft — it never bypasses the eval-gate/reviewer/sandbox promotion gate.</AlertDescription>
        </Alert>
        <Button className="mt-4" onClick={() => router.push(`/agent-platform/versions/${createdVersionId}`)}>
          View version
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-2 font-heading text-lg font-semibold">Design Studio — {definitionName}</h1>
      <p className="mb-6 text-sm text-muted-foreground" role="status">
        Step {step} of 10 — {STEP_LABELS[step - 1]}
      </p>

      {error && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {step === 1 && (
        <Card className="flex flex-col gap-4 p-6">
          <div>
            <div className="flex items-center gap-1">
              <label htmlFor="studio-instructions" className="text-sm font-medium">Instructions*</label>
              <FieldHint id="studio-instructions-hint" content="The agent's persona and core purpose — becomes spec.instructions verbatim." />
            </div>
            <Textarea id="studio-instructions" className="min-h-[160px]" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          </div>
          <Button disabled={busy || !instructions.trim()} onClick={() => void handlePurpose()}>{busy ? "Saving…" : "Continue"}</Button>
        </Card>
      )}

      {step === 2 && (
        <Card className="flex flex-col gap-4 p-6">
          <div>
            <div className="flex items-center gap-1">
              <label className="text-sm font-medium">Trust level*</label>
              <FieldHint id="studio-trust-hint" content="Feeds the PII masking-context matrix (spec.trustLevel) — a version may only tighten the tenant's own masking floor, never loosen it." />
            </div>
            <Select value={trustLevel} onValueChange={(v) => v !== null && setTrustLevel(v as (typeof TRUST_LEVELS)[number])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TRUST_LEVELS.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Channels</label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {CHANNEL_TYPES.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={Boolean(channelTypes[c])} onCheckedChange={(v) => setChannelTypes((prev) => ({ ...prev, [c]: v === true }))} />
                  {c}
                </label>
              ))}
            </div>
          </div>
          <Button disabled={busy} onClick={() => void handleAudience()}>{busy ? "Saving…" : "Continue"}</Button>
        </Card>
      )}

      {step === 3 && (
        <Card className="flex flex-col gap-4 p-6">
          <div>
            <div className="flex items-center gap-1">
              <label htmlFor="studio-skills" className="text-sm font-medium">Skills (comma-separated pins)</label>
              <FieldHint id="studio-skills-hint" content="Version-pinned skills from the Skills Library, e.g. refund_request@3, billing_lookup@1." />
            </div>
            <Input id="studio-skills" value={skillPinsText} onChange={(e) => setSkillPinsText(e.target.value)} placeholder="refund_request@3, billing_lookup@1" />
          </div>
          <Button disabled={busy} onClick={() => void handleSkills()}>{busy ? "Saving…" : "Continue"}</Button>
        </Card>
      )}

      {step === 4 && (
        <Card className="flex flex-col gap-4 p-6">
          <div>
            <div className="flex items-center gap-1">
              <label htmlFor="studio-groups" className="text-sm font-medium">Capability groups (comma-separated names)</label>
              <FieldHint id="studio-groups-hint" content="Reuses the same real, enforced capability-group restriction Text/Design mode already use — never a second, unenforced mechanism." />
            </div>
            <Input id="studio-groups" value={capabilityGroupsText} onChange={(e) => setCapabilityGroupsText(e.target.value)} />
          </div>
          <div>
            <label htmlFor="studio-max-tool-calls" className="text-sm font-medium">Max tool calls per turn</label>
            <Input id="studio-max-tool-calls" type="number" min={1} value={maxToolCallsPerTurn} onChange={(e) => setMaxToolCallsPerTurn(Number(e.target.value))} />
          </div>
          <Button disabled={busy} onClick={() => void handleTools()}>{busy ? "Saving…" : "Continue"}</Button>
        </Card>
      )}

      {step === 5 && (
        <Card className="flex flex-col gap-4 p-6">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={knowledgeEnabled} onCheckedChange={(v) => setKnowledgeEnabled(v === true)} />
            This agent retrieves from a knowledge collection
          </label>
          {knowledgeEnabled && (
            <>
              <div>
                <label htmlFor="studio-collections" className="text-sm font-medium">Collections (comma-separated, "name@N")</label>
                <Input id="studio-collections" value={knowledgeCollectionsText} onChange={(e) => setKnowledgeCollectionsText(e.target.value)} />
              </div>
              <div>
                <label htmlFor="studio-min-citations" className="text-sm font-medium">Minimum citations</label>
                <Input id="studio-min-citations" type="number" min={0} value={minCitations} onChange={(e) => setMinCitations(Number(e.target.value))} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={refuseWhenUngrounded} onCheckedChange={(v) => setRefuseWhenUngrounded(v === true)} />
                Refuse when ungrounded (recommended)
              </label>
            </>
          )}
          <Button disabled={busy} onClick={() => void handleKnowledge()}>{busy ? "Saving…" : "Continue"}</Button>
        </Card>
      )}

      {step === 6 && (
        <Card className="flex flex-col gap-4 p-6">
          <div>
            <label htmlFor="studio-min-confidence" className="text-sm font-medium">Minimum confidence for autonomy</label>
            <Input id="studio-min-confidence" type="number" min={0} max={1} step={0.05} value={minConfidenceForAutonomy} onChange={(e) => setMinConfidenceForAutonomy(Number(e.target.value))} />
          </div>
          <div>
            <label className="text-sm font-medium">Escalate on</label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {ESCALATION_REASONS.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={Boolean(escalateOn[r])} onCheckedChange={(v) => setEscalateOn((prev) => ({ ...prev, [r]: v === true }))} />
                  {r}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1">
              <label className="text-sm font-medium">PII masking floor (tightening-only)</label>
              <FieldHint id="studio-masking-hint" content="Optional per-context floor — this version may only make masking STRICTER than the tenant default, never looser. Saving a looser value fails validation (GUARDRAIL_LOOSENED)." />
            </div>
            <div className="mt-2 flex flex-col gap-2">
              {PII_CONTEXTS.map((context) => (
                <div key={context} className="flex items-center gap-2">
                  <span className="w-40 text-sm">{context}</span>
                  <Select value={maskingFloor[context] ?? ""} onValueChange={(v) => setMaskingFloor((prev) => ({ ...prev, [context]: v ?? "" }))}>
                    <SelectTrigger className="w-[180px]"><SelectValue placeholder="(no floor declared)" /></SelectTrigger>
                    <SelectContent>
                      {MASK_ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
          <Button disabled={busy} onClick={() => void handleGuardrails()}>{busy ? "Saving…" : "Continue"}</Button>
        </Card>
      )}

      {step === 7 && (
        <Card className="flex flex-col gap-4 p-6">
          <div>
            <label className="text-sm font-medium">Model route</label>
            <Select value={modelRoute} onValueChange={(v) => v !== null && setModelRoute(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROUTE_KEYS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor="studio-max-cost" className="text-sm font-medium">Max cost (USD) per conversation</label>
            <Input id="studio-max-cost" value={maxCostUsdPerConversation} onChange={(e) => setMaxCostUsdPerConversation(e.target.value)} />
          </div>
          <div>
            <label htmlFor="studio-max-latency" className="text-sm font-medium">Max p95 latency (ms)</label>
            <Input id="studio-max-latency" type="number" min={0} value={maxLatencyMsP95} onChange={(e) => setMaxLatencyMsP95(Number(e.target.value))} />
          </div>
          <Button disabled={busy} onClick={() => void handleModelBudgets()}>{busy ? "Saving…" : "Continue"}</Button>
        </Card>
      )}

      {step === 8 && (
        <Card className="flex flex-col gap-4 p-6">
          <div>
            <label htmlFor="studio-max-turns" className="text-sm font-medium">Rolling-window max turns</label>
            <Input id="studio-max-turns" type="number" min={1} value={maxTurns} onChange={(e) => setMaxTurns(Number(e.target.value))} />
          </div>
          <Button disabled={busy} onClick={() => void handleMemory()}>{busy ? "Saving…" : "Continue"}</Button>
        </Card>
      )}

      {step === 9 && (
        <Card className="flex flex-col gap-4 p-6">
          <p className="text-sm text-muted-foreground">Auto-generated from the composed skills' own eval cases — deselect any you don't want included.</p>
          {availableCases.length === 0 && <p className="text-sm text-muted-foreground">No composed skill has any eval cases yet.</p>}
          <div className="flex flex-col gap-2">
            {availableCases.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={Boolean(includedCaseIds[c.id])} onCheckedChange={(v) => setIncludedCaseIds((prev) => ({ ...prev, [c.id]: v === true }))} />
                {c.name} <span className="text-muted-foreground">({c.skillName})</span>
              </label>
            ))}
          </div>
          <Button disabled={busy} onClick={() => void handleEvals()}>{busy ? "Saving…" : "Continue to Review"}</Button>
        </Card>
      )}

      {step === 10 && (
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex items-start gap-4">
            <div className="max-w-[160px]">
              <label htmlFor="studio-version" className="text-sm font-medium">Version</label>
              <Input id="studio-version" value={version} onChange={(e) => setVersion(e.target.value)} />
            </div>
            <div className="max-w-[220px]">
              <label className="text-sm font-medium">Graph type</label>
              <Select value={graphType} onValueChange={(v) => v !== null && setGraphType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GRAPH_TYPES.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Full YAML preview</p>
            <Textarea readOnly value={previewYaml} className="min-h-[400px] font-mono text-sm" aria-label="Studio-composed agent definition YAML preview" />
          </div>
          <p className="text-sm text-muted-foreground">
            This always lands as a <strong>Draft</strong> — the eval-gate, reviewer-not-author, and sandbox-conversation conditions of the
            promotion gate still apply exactly as they do for Text/Design mode.
          </p>
          {blueprintSaved && (
            <Alert>
              <AlertDescription>Saved as a tenant-local blueprint — visible to this tenant's admins on the Blueprints Gallery.</AlertDescription>
            </Alert>
          )}
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void handleSubmit()}>{busy ? "Saving…" : "Save as Draft"}</Button>
            <Button variant="outline" disabled={busy || !previewArtifact} onClick={() => void handleSaveAsBlueprint()}>
              Save as blueprint
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
