"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import yaml from "js-yaml";
import { Value } from "@sinclair/typebox/value";
import { TeamArtifactSchema, type TeamArtifact, type TeamValidationWarning } from "@nextbot/contracts";
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
 * Target Architecture Blueprint Phase 14 (BL-46, LLD §14.7.5) — the team version
 * editor, Text-mode YAML.
 *
 * Deliberately Text-mode only for this phase (the dispatch brief's own scoping: "a
 * Studio-equivalent for teams is NOT required here"). It mirrors the agent-definition
 * `VersionEditor`'s structure exactly — same client-side TypeBox pre-validation
 * against the SAME schema the server enforces, same immutable-versions rule (this
 * screen only ever CREATES; it never edits a version in place), same
 * `humanizeYamlParseError` handling.
 *
 * One addition over that editor, driven by FR-ORC-03: a "Validate" action that calls
 * the server's own non-strict validator, so an author sees
 * `TEAM_SUPERVISOR_ROUTE_EXPENSIVE` (and any unresolvable member pin) as a warning
 * while still editing, instead of only as a 422 on save.
 */

const SCAFFOLD = (name: string) => `kind: team
name: ${name}
version: 1
description: ""
supervisor:
  # Must be a cheap router-class route (FR-ORC-03) — never a frontier model.
  agent: support_triage@0.1.0
  route: chat.router
limits:
  # Every limit is required — an omitted safety ceiling is rejected, never guessed.
  maxDepth: 2
  maxFanOut: 2
  maxDelegations: 4
  runBudget:
    usd: 1
    seconds: 120
  thrashWindow:
    repeats: 2
    similarityThreshold: 0.92
# Required. 'Escalate' is currently the only mode — never silently degrade.
failureMode: Escalate
members:
  - key: billing
    agent: billing_agent@0.1.0
    delegationTier: Tier2
    invokeWhen: the customer asks about an invoice, a refund, or a payment
    fallbackAction: Escalate
`;

export interface TeamEditorProps {
  /** `create-team` also creates version 1; `new-version` appends to an existing team. */
  mode: "create-team" | "new-version";
  teamId?: string;
  teamName?: string;
}

export function TeamEditor({ mode, teamId, teamName }: TeamEditorProps) {
  const router = useRouter();
  const [name, setName] = useState(teamName ?? "");
  const [yamlText, setYamlText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<TeamValidationWarning[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setYamlText((current) => current || SCAFFOLD(teamName ?? "support_team"));
  }, [teamName]);

  /** Client-side structural check against the SAME TypeBox schema the server
   * enforces — one contract, two checks, never two definitions. Returns the parsed
   * artifact, or `null` after populating `errors`. */
  function validateLocally(): TeamArtifact | null {
    let parsed: unknown;
    try {
      parsed = yaml.load(yamlText);
    } catch (err) {
      setErrors([humanizeYamlParseError(err)]);
      return null;
    }
    if (!Value.Check(TeamArtifactSchema, parsed)) {
      setErrors([...Value.Errors(TeamArtifactSchema, parsed)].map((e) => `${e.path || "(root)"}: ${e.message}`));
      return null;
    }
    setErrors([]);
    return parsed;
  }

  /** Non-strict server validation — resolves every pin and the supervisor route
   * class against the real database, which the client cannot do. */
  async function handleValidate() {
    const artifact = validateLocally();
    if (!artifact) return;
    const targetTeamId = teamId ?? "new";
    const result = await fetchJson<{ valid: boolean; warnings: TeamValidationWarning[]; errors: TeamValidationWarning[] }>(
      `/api/v1/admin/teams/${targetTeamId}/versions/new/validate`,
      { method: "POST", body: JSON.stringify({ yaml: yamlText }) },
    );
    if (result.kind !== "ok") {
      setErrors([result.kind === "forbidden" ? "You do not have permission to validate teams." : result.message]);
      return;
    }
    setWarnings(result.data.warnings);
    setErrors(result.data.errors.map((e) => `${e.path ?? "(root)"}: ${e.message}`));
    if (result.data.valid && result.data.warnings.length === 0) toast.success("Team artifact is valid.");
  }

  async function handleSubmit() {
    const artifact = validateLocally();
    if (!artifact) return;
    setSubmitting(true);
    try {
      if (mode === "create-team") {
        const result = await fetchJson<{ team: { id: string } }>("/api/v1/admin/teams", {
          method: "POST",
          body: JSON.stringify({ name, description: artifact.description, artifact }),
        });
        if (result.kind !== "ok") {
          setErrors([result.kind === "forbidden" ? "You do not have permission to create teams." : result.message]);
          return;
        }
        toast.success("Team created.");
        router.push(`/teams/${result.data.team.id}`);
        return;
      }

      const result = await fetchJson<{ version: { id: string } }>(`/api/v1/admin/teams/${teamId}/versions`, {
        method: "POST",
        body: JSON.stringify({ artifact }),
      });
      if (result.kind !== "ok") {
        setErrors([result.kind === "forbidden" ? "You do not have permission to create team versions." : result.message]);
        return;
      }
      toast.success("Team version created as Draft.");
      router.push(`/teams/${teamId}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="font-heading mb-6 text-lg font-semibold">{mode === "create-team" ? "New Team" : `New version — ${teamName}`}</h1>

      {mode === "create-team" && (
        <div className="mb-4 max-w-md">
          <Label htmlFor="team-name">Team name</Label>
          <Input
            id="team-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-describedby="team-name-hint"
            placeholder="support_team"
          />
          <FieldHint id="team-name-hint" content="Lower-case letters, digits and underscores. Must match the `name` field in the YAML below." />
        </div>
      )}

      <Label htmlFor="team-yaml">Team artifact (YAML)</Label>
      <Textarea
        id="team-yaml"
        value={yamlText}
        onChange={(e) => setYamlText(e.target.value)}
        className="min-h-[500px] font-mono text-sm"
        aria-label="Team artifact YAML editor"
        aria-describedby={errors.length > 0 ? "team-yaml-errors" : "team-yaml-hint"}
      />
      <FieldHint
        id="team-yaml-hint"
        content="One router-class supervisor plus one or more version-pinned specialists. Every limit and `failureMode` are required — an omitted safety ceiling is rejected rather than defaulted."
      />

      {errors.length > 0 && (
        <Alert variant="destructive" className="mt-4" id="team-yaml-errors" aria-live="polite">
          <AlertTitle>This team artifact cannot be saved</AlertTitle>
          <AlertDescription>
            <ul className="list-disc ps-5">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {warnings.length > 0 && (
        <Alert className="mt-4" aria-live="polite">
          <AlertTitle>Warnings</AlertTitle>
          <AlertDescription>
            <ul className="list-disc ps-5">
              {warnings.map((w) => (
                <li key={`${w.code}:${w.path}`}>
                  <strong>{w.code}</strong> {w.path ? `(${w.path})` : ""} — {w.message}
                </li>
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
          {submitting ? "Saving…" : mode === "create-team" ? "Create team" : "Create version"}
        </Button>
      </div>
    </div>
  );
}
