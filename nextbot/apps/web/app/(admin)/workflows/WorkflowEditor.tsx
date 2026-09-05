"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import yaml from "js-yaml";
import { Value } from "@sinclair/typebox/value";
import { WorkflowGraphSchema, type WorkflowGraph, type WorkflowGraphIssue } from "@nextbot/contracts";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@nextbot/ui/components/ui/alert";
import { toast } from "@nextbot/ui/lib/toast";
import { fetchJson } from "@/src/lib/fetch-json";
import { humanizeYamlParseError } from "@/src/lib/humanize-yaml-error";

/**
 * Target Architecture Blueprint Phase 15 (BL-47a, LLD §14.6.4) — the workflow
 * version editor, Text-mode YAML.
 *
 * Deliberately Text-mode only for this phase (this dispatch's own scoping: "a
 * visual node-graph canvas is explicitly out of scope for this phase" — matches
 * this project's own precedent: the Agent Design Studio and `teams`' own editor
 * both shipped Text-mode-equivalent first). Mirrors `TeamEditor`'s structure
 * exactly — same client-side TypeBox pre-validation against the SAME schema the
 * server enforces, same immutable-versions rule (this screen only ever CREATES;
 * it never edits a version in place), same `humanizeYamlParseError` handling.
 *
 * The "Validate" action calls the server's own `POST .../validate`, surfacing
 * every V1-V12 rule failure by node id, so an author sees the problem while still
 * editing instead of only as a 422 on save.
 */

const SCAFFOLD = (name: string) => `apiVersion: nextbot.io/v1
kind: Workflow
metadata:
  name: ${name}
  version: 1
spec:
  runLimits:
    # Every limit is required — an omitted safety ceiling is rejected, never guessed.
    maxSteps: 50
    maxCostUsd: 5
    maxWallClockSeconds: 300
    maxLoopIterations: 20
    maxParallelBranches: 4
    maxSubWorkflowDepth: 4
  nodes:
    - id: trigger_1
      kind: Trigger
      source:
        kind: ChannelEvent
        channelTypes: [WebWidget]
        event: conversation.started
      next: end_1
    - id: end_1
      kind: End
      outcome: Resolved
`;

export interface WorkflowEditorProps {
  /** `create-workflow` also creates version 1; `new-version` appends to an
   * existing workflow. */
  mode: "create-workflow" | "new-version";
  workflowId?: string;
  workflowName?: string;
}

export function WorkflowEditor({ mode, workflowId, workflowName }: WorkflowEditorProps) {
  const router = useRouter();
  const [name, setName] = useState(workflowName ?? "");
  const [yamlText, setYamlText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setYamlText((current) => current || SCAFFOLD(workflowName ?? "support_workflow"));
  }, [workflowName]);

  /** Client-side structural check against the SAME TypeBox schema the server
   * enforces — one contract, two checks, never two definitions. Returns the
   * parsed artifact, or `null` after populating `errors`. */
  function validateLocally(): WorkflowGraph | null {
    let parsed: unknown;
    try {
      parsed = yaml.load(yamlText);
    } catch (err) {
      setErrors([humanizeYamlParseError(err)]);
      return null;
    }
    if (!Value.Check(WorkflowGraphSchema, parsed)) {
      setErrors([...Value.Errors(WorkflowGraphSchema, parsed)].map((e) => `${e.path || "(root)"}: ${e.message}`));
      return null;
    }
    setErrors([]);
    return parsed;
  }

  /** Server-side V1-V12 validation — resolves every pinned reference and folds
   * every node's scope through the real evaluator, neither of which the client
   * can do. */
  async function handleValidate() {
    const artifact = validateLocally();
    if (!artifact) return;
    const targetWorkflowId = workflowId ?? "new";
    const result = await fetchJson<{ valid: boolean; errors: WorkflowGraphIssue[] }>(
      `/api/v1/admin/workflows/${targetWorkflowId}/versions/new/validate`,
      { method: "POST", body: JSON.stringify({ yaml: yamlText }) },
    );
    if (result.kind !== "ok") {
      setErrors([result.kind === "forbidden" ? "You do not have permission to validate workflows." : result.message]);
      return;
    }
    setErrors(result.data.errors.map((e) => `${e.path ?? "(root)"} [${e.code}] — ${e.message}`));
    if (result.data.valid) toast.success("Workflow graph is valid.");
  }

  async function handleSubmit() {
    const artifact = validateLocally();
    if (!artifact) return;
    setSubmitting(true);
    try {
      if (mode === "create-workflow") {
        const result = await fetchJson<{ workflow: { id: string } }>("/api/v1/admin/workflows", {
          method: "POST",
          body: JSON.stringify({ name, artifact }),
        });
        if (result.kind !== "ok") {
          setErrors([result.kind === "forbidden" ? "You do not have permission to create workflows." : result.message]);
          return;
        }
        toast.success("Workflow created.");
        router.push(`/workflows/${result.data.workflow.id}`);
        return;
      }

      const result = await fetchJson<{ version: { id: string } }>(`/api/v1/admin/workflows/${workflowId}/versions`, {
        method: "POST",
        body: JSON.stringify({ artifact }),
      });
      if (result.kind !== "ok") {
        setErrors([result.kind === "forbidden" ? "You do not have permission to create workflow versions." : result.message]);
        return;
      }
      toast.success("Workflow version created as Draft.");
      router.push(`/workflows/${workflowId}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="font-heading mb-6 text-lg font-semibold">{mode === "create-workflow" ? "New Workflow" : `New version — ${workflowName}`}</h1>

      {mode === "create-workflow" && (
        <div className="mb-4 max-w-md">
          <Label htmlFor="workflow-name">Workflow name</Label>
          <Input
            id="workflow-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-describedby="workflow-name-hint"
            placeholder="support_workflow"
          />
          <FieldHint id="workflow-name-hint" content="Lower-case letters, digits and underscores. Must match the `metadata.name` field in the YAML below." />
        </div>
      )}

      <Label htmlFor="workflow-yaml">Workflow graph (YAML)</Label>
      <Textarea
        id="workflow-yaml"
        value={yamlText}
        onChange={(e) => setYamlText(e.target.value)}
        className="min-h-[500px] font-mono text-sm"
        aria-label="Workflow graph YAML editor"
        aria-describedby={errors.length > 0 ? "workflow-yaml-errors" : "workflow-yaml-hint"}
      />
      <FieldHint
        id="workflow-yaml-hint"
        content="Exactly one Trigger node, every path must reach an End node, and every safety limit (runLimits) is required — an omitted ceiling is rejected rather than defaulted."
      />

      {errors.length > 0 && (
        <Alert variant="destructive" className="mt-4" id="workflow-yaml-errors" aria-live="polite">
          <AlertTitle>This workflow graph cannot be saved</AlertTitle>
          <AlertDescription>
            <ul className="list-disc ps-5">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-4 flex gap-2">
        <Button variant="outline" onClick={() => void handleValidate()}>
          Validate
        </Button>
        <Button onClick={() => void handleSubmit()} disabled={submitting}>
          {submitting ? "Saving…" : mode === "create-workflow" ? "Create workflow" : "Create version"}
        </Button>
      </div>
    </div>
  );
}
