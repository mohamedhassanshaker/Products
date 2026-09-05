"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@nextbot/ui/components/ui/alert";
import { toast } from "@nextbot/ui/lib/toast";
import { fetchJson } from "@/src/lib/fetch-json";

/** A skill's authored artifact shape (Blueprint §8.1) — kept local rather than
 * importing `@nextbot/contracts`' `SkillArtifact` type into a client component
 * bundle unnecessarily; the fields mirror it exactly. */
export interface SkillFormValues {
  name: string;
  trigger: string;
  capabilityGroups: string;
  tools: string;
  knowledge: string;
  instructions: string;
  successCriteria: string;
  escalateWhen: string;
  evalCases: string;
}

function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const EMPTY: SkillFormValues = {
  name: "",
  trigger: "",
  capabilityGroups: "",
  tools: "",
  knowledge: "",
  instructions: "",
  successCriteria: "",
  escalateWhen: "",
  evalCases: "",
};

/**
 * The Skills Library's editor. **Design decision** (recorded per the dev brief's
 * request for reasoning): unlike the Agent Version editor's Text/Design-mode
 * toggle, this is a single structured form with no raw-YAML "Text mode" at all.
 * The Agent Version artifact spans nine composed dimensions (routing, tools,
 * guardrails, memory, budgets, evals, …) where a power user genuinely benefits
 * from pasting/editing YAML directly; a skill's authored shape (Blueprint §8.1) is
 * eight flat fields with no nesting a form can't represent cleanly, so a second
 * "Text" mode would only add a parity-maintenance burden (keeping two
 * representations in sync) for a shape that's already fully representable as
 * plain fields. The server still canonicalizes to YAML and computes `yaml_hash`
 * exactly the same way — this is a client-rendering choice only, not a schema
 * difference.
 */
export function SkillForm({
  mode,
  skillId,
  nextVersion,
  initial,
}: {
  mode: "create" | "version";
  skillId?: string;
  nextVersion?: number;
  initial?: Partial<SkillFormValues>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<SkillFormValues>({ ...EMPTY, ...initial });
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof SkillFormValues>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function buildArtifact(version: number) {
    return {
      kind: "skill" as const,
      name: values.name,
      version,
      trigger: values.trigger,
      scope: {
        capabilityGroups: splitList(values.capabilityGroups),
        tools: splitList(values.tools),
        knowledge: splitList(values.knowledge),
      },
      instructions: values.instructions,
      successCriteria: values.successCriteria,
      escalateWhen: splitList(values.escalateWhen),
      evalCases: splitList(values.evalCases),
    };
  }

  async function handleSubmit() {
    setErrors([]);
    if (!values.name.trim() || !values.trigger.trim() || !values.instructions.trim() || !values.successCriteria.trim()) {
      setErrors(["Name, trigger, instructions, and success criteria are all required."]);
      return;
    }
    setSubmitting(true);
    if (mode === "create") {
      const result = await fetchJson<{ skill: { id: string } }>("/api/v1/admin/skills", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: values.name, description: description || undefined, artifact: buildArtifact(1) }),
      });
      setSubmitting(false);
      if (result.kind !== "ok") {
        toast.error(result.message);
        return;
      }
      router.push(`/skills/${result.data.skill.id}`);
    } else {
      const result = await fetchJson<{ version: { id: string } }>(`/api/v1/admin/skills/${skillId}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifact: buildArtifact(nextVersion ?? 1) }),
      });
      setSubmitting(false);
      if (result.kind !== "ok") {
        toast.error(result.message);
        return;
      }
      router.push(`/skills/${skillId}`);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-lg font-semibold">
        {mode === "create" ? "New Skill" : `New version for ${values.name || "this skill"}`}
      </h1>

      <div>
        <div className="mb-1 flex items-center gap-1">
          <Label htmlFor="skill-name">Name</Label>
          <FieldHint id="skill-name-hint" content="A short, code-like identifier (letters, digits, underscores) — this is how the skill is pinned by consumers, e.g. 'refund_request@3'. Cannot be changed once created." />
        </div>
        <Input id="skill-name" value={values.name} onChange={(e) => set("name", e.target.value)} disabled={mode === "version"} placeholder="refund_request" />
      </div>

      {mode === "create" && (
        <div>
          <div className="mb-1 flex items-center gap-1">
            <Label htmlFor="skill-description">Description</Label>
            <FieldHint id="skill-description-hint" content="Optional context shown in the Skills Library list — not part of the composed artifact itself." />
          </div>
          <Textarea id="skill-description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center gap-1">
          <Label htmlFor="skill-trigger">Trigger</Label>
          <FieldHint id="skill-trigger-hint" content="A natural-language description of when this skill applies, e.g. 'customer asks to reverse a completed payment'." />
        </div>
        <Textarea id="skill-trigger" value={values.trigger} onChange={(e) => set("trigger", e.target.value)} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <div className="mb-1 flex items-center gap-1">
            <Label htmlFor="skill-capability-groups">Capability groups</Label>
            <FieldHint id="skill-capability-groups-hint" content="Comma-separated capability group names this skill's scope draws from, e.g. 'billing'. Must already exist for this tenant — validated at save." />
          </div>
          <Input id="skill-capability-groups" value={values.capabilityGroups} onChange={(e) => set("capabilityGroups", e.target.value)} placeholder="billing" />
        </div>
        <div>
          <div className="mb-1 flex items-center gap-1">
            <Label htmlFor="skill-tools">Tools</Label>
            <FieldHint id="skill-tools-hint" content="Comma-separated tool pins in 'toolName@connectorName' form, e.g. 'payment.refund@billing_core'. Validated at save." />
          </div>
          <Input id="skill-tools" value={values.tools} onChange={(e) => set("tools", e.target.value)} placeholder="payment.refund@billing_core" />
        </div>
        <div>
          <div className="mb-1 flex items-center gap-1">
            <Label htmlFor="skill-knowledge">Knowledge collections</Label>
            <FieldHint id="skill-knowledge-hint" content="Comma-separated knowledge collection names. Stored as authored — there's nothing to validate against until Knowledge/Graph RAG ships." />
          </div>
          <Input id="skill-knowledge" value={values.knowledge} onChange={(e) => set("knowledge", e.target.value)} placeholder="billing_policy" />
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center gap-1">
          <Label htmlFor="skill-instructions">Instructions</Label>
          <FieldHint id="skill-instructions-hint" content="The instruction fragment assembled into a composing agent's prompt when this skill applies." />
        </div>
        <Textarea id="skill-instructions" value={values.instructions} onChange={(e) => set("instructions", e.target.value)} className="min-h-[140px]" />
      </div>

      <div>
        <div className="mb-1 flex items-center gap-1">
          <Label htmlFor="skill-success-criteria">Success criteria</Label>
          <FieldHint id="skill-success-criteria-hint" content="A short description of what a successful outcome looks like, e.g. 'refund issued, or a stated reason why not'." />
        </div>
        <Input id="skill-success-criteria" value={values.successCriteria} onChange={(e) => set("successCriteria", e.target.value)} />
      </div>

      <div>
        <div className="mb-1 flex items-center gap-1">
          <Label htmlFor="skill-escalate-when">Escalate when</Label>
          <FieldHint id="skill-escalate-when-hint" content="One condition per line, e.g. 'amount > 500'. Each is evaluated the same way a guardrail rule's conditions are." />
        </div>
        <Textarea id="skill-escalate-when" value={values.escalateWhen} onChange={(e) => set("escalateWhen", e.target.value)} />
      </div>

      <div>
        <div className="mb-1 flex items-center gap-1">
          <Label htmlFor="skill-eval-cases">Eval cases</Label>
          <FieldHint id="skill-eval-cases-hint" content="Comma-separated eval-case keys from Agent Platform's eval suites — validated when an agent version actually composes this skill." />
        </div>
        <Input id="skill-eval-cases" value={values.evalCases} onChange={(e) => set("evalCases", e.target.value)} placeholder="ec_refund_happy, ec_refund_partial" />
      </div>

      {errors.length > 0 && (
        <Alert variant="destructive" aria-live="polite">
          <AlertTitle>Validation errors</AlertTitle>
          <AlertDescription>
            <ul className="mt-2 flex flex-col gap-1 ps-6">
              {errors.map((e, i) => (
                <li key={i} className="text-sm">
                  {e}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div>
        <Button onClick={() => void handleSubmit()} disabled={submitting}>
          {submitting ? "Saving…" : mode === "create" ? "Create Skill" : "Create Version"}
        </Button>
      </div>
    </div>
  );
}
