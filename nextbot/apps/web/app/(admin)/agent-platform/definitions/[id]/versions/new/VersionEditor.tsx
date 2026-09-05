"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import NextLink from "next/link";
import yaml from "js-yaml";
import { Value } from "@sinclair/typebox/value";
import { AgentDefinitionArtifactSchema } from "@nextbot/contracts";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@nextbot/ui/components/ui/alert";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@nextbot/ui/components/ui/tabs";
import { toast } from "@nextbot/ui/lib/toast";
import { fetchJson } from "@/src/lib/fetch-json";
import { humanizeYamlParseError } from "@/src/lib/humanize-yaml-error";
import { GRAPH_TYPES, ROUTE_KEYS } from "./version-editor-constants";
import { DesignModeForm } from "./DesignModeForm";

const SCAFFOLD = (name: string, version: string) => `apiVersion: nextbot.io/v1
kind: AgentDefinition
metadata:
  name: ${name}
  version: ${version}
spec:
  graphType: ADK
  modelRoute: chat.primary
  instructions: |
    You are a helpful support agent.
  toolPolicy:
    source: agent-tool-registry
    capabilityGroups: []
    maxToolCallsPerTurn: 5
  guardrails:
    minConfidenceForAutonomy: 0.6
    escalateOn: [LowConfidence]
  memory:
    strategy: rolling-window
    maxTurns: 20
  evalSuite: ""
  budgets:
    maxCostUsdPerConversation: "0.50"
    maxLatencyMsP95: 6000
`;

/** Phase 7 (client-feedback-batch item 6) — "Restore" pre-fill shape, the same
 * `GET /versions/:id` read `VersionDetail.tsx` already uses (confirmed to return
 * `definitionYaml`/`graphType`/`modelRouteKey` verbatim). Only the fields this
 * screen actually pre-fills are declared here. */
interface RestoreSourceVersion {
  version: string;
  graphType: string;
  modelRouteKey: string;
  definitionYaml: string;
}

/** Suggests the next version label for a "Restore" pre-fill — bumps the patch
 * component of a semver-shaped string (e.g. "0.1.0" -> "0.1.1"). Falls back to
 * appending a "-restored" suffix for a non-semver label rather than guessing at a
 * bump that could collide with an existing version (the field stays freely
 * editable either way — this is only a starting suggestion, never enforced). */
function suggestNextVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(version);
  if (!match) return `${version}-restored`;
  const [, major, minor, patch, rest] = match;
  return `${major}.${minor}.${Number(patch) + 1}${rest}`;
}

/**
 * BL-07 Version Editor (UX_GUIDELINES.md §6.4). Versions are immutable once created:
 * this screen only ever *creates* a new version, never edits an existing one in place.
 *
 * Phase 9 (client-feedback-batch item 7) added a "Design mode" / "Text mode" toggle.
 * "Text" is this screen's original plain YAML textarea, unchanged. "Design"
 * (`DesignModeForm.tsx`) is a structured form over the same `AgentDefinitionArtifact`
 * shape — real fields per artifact section, generating/parsing the identical YAML Text
 * mode edits, so either mode can be used interchangeably on the same version. This is
 * deliberately a structured *form*, not a visual node-graph canvas — that remains a
 * separate, unbuilt future item (BL-16), not conflated with this screen (nor with
 * BL-19's later "Code-First Agent Builder", per §6.0). `yamlText` below is the single
 * source of truth regardless of which tab is active: Design mode reads it once per
 * mount (tabs unmount their inactive panel by default — see `tabs.tsx`) and writes
 * back through it via `onYamlChange` on every field edit, so `validate()`/`handleSubmit`
 * below need no awareness of which mode produced the current text.
 */
export function VersionEditor({ definitionId }: { definitionId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Phase 7 (client-feedback-batch item 6) — "Restore": `DefinitionDetail.tsx`'s
  // Restore row-action links here with `?fromVersionId=<old version id>`. This
  // screen only ever *creates* a new version (see this component's own top-level
  // doc comment) — restoring an old version's content is not a new domain
  // operation, it's this exact same create flow, just pre-filled from that old
  // version's YAML instead of the blank scaffold. History is never mutated: the
  // source version row is only ever read (`GET .../versions/:id`), never touched.
  const fromVersionId = searchParams.get("fromVersionId");
  const [definitionName, setDefinitionName] = useState("");
  const [version, setVersion] = useState("0.1.0");
  const [graphType, setGraphType] = useState("ADK");
  const [modelRouteKey, setModelRouteKey] = useState("chat.primary");
  const [yamlText, setYamlText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  // Genuine Git failure on a *configured* connection (ADR-0009's 2026-08-23 amendment
  // only degrades the "no connection at all" case gracefully — this stays a visible,
  // blocking-in-place error so a real sync loss is never mistaken for the graceful
  // no-connection path below).
  const [gitUnavailable, setGitUnavailable] = useState(false);
  // No Git connection configured for this tenant at all — the version was still
  // created successfully (Postgres is the source of truth); this is informational,
  // not an error, and doesn't block the user from continuing.
  const [noGitSync, setNoGitSync] = useState(false);
  const [createdVersionId, setCreatedVersionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ definition: { name: string } }>(`/api/v1/admin/agent-platform/definitions/${definitionId}`).then((r) => {
      if (r.kind !== "ok") return;
      setDefinitionName(r.data.definition.name);
      if (fromVersionId) {
        // Restore path — pre-fill from the source version's real, immutable YAML
        // (never a blank scaffold) once it loads below; keep the definition name
        // resolved here regardless of which path this effect took.
        return;
      }
      setYamlText(SCAFFOLD(r.data.definition.name, "0.1.0"));
    });
  }, [definitionId, fromVersionId]);

  useEffect(() => {
    if (!fromVersionId) return;
    fetchJson<{ version: RestoreSourceVersion }>(`/api/v1/admin/agent-platform/versions/${fromVersionId}`).then((r) => {
      if (r.kind !== "ok") {
        toast.error(r.message);
        return;
      }
      const source = r.data.version;
      setVersion(suggestNextVersion(source.version));
      setGraphType(source.graphType);
      setModelRouteKey(source.modelRouteKey);
      setYamlText(source.definitionYaml);
    });
  }, [fromVersionId]);

  function validate(): unknown | null {
    let parsed: unknown;
    try {
      parsed = yaml.load(yamlText);
    } catch (err) {
      // QA Defect U3: humanize this the same way schema-validation errors already are
      // on this screen, instead of surfacing js-yaml's raw parser diagnostic verbatim.
      setErrors([humanizeYamlParseError(err)]);
      return null;
    }
    if (!Value.Check(AgentDefinitionArtifactSchema, parsed)) {
      const errs = [...Value.Errors(AgentDefinitionArtifactSchema, parsed)].map((e) => `${e.path}: ${e.message}`);
      setErrors(errs);
      return null;
    }
    setErrors([]);
    return parsed;
  }

  async function handleSubmit() {
    const artifact = validate();
    if (!artifact) return;
    setSubmitting(true);
    setGitUnavailable(false);
    setNoGitSync(false);
    const result = await fetchJson<{ version: { id: string; gitCommitSha: string | null } }>(
      `/api/v1/admin/agent-platform/definitions/${definitionId}/versions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version, graphType, modelRouteKey, artifact }),
      },
    );
    setSubmitting(false);
    if (result.kind !== "ok") {
      if (result.kind === "error" && result.message.includes("Git connection unavailable")) {
        // A configured connection's provider call genuinely failed mid-commit — a
        // real problem, kept as a visible, blocking-in-place error (ADR-0009's
        // 2026-08-23 amendment does not degrade this case, only "no connection at
        // all").
        setGitUnavailable(true);
      } else {
        toast.error(result.message);
      }
      return;
    }
    if (result.data.version.gitCommitSha === null) {
      // No Git connection configured for this tenant at all — the version was still
      // created (Postgres is the source of truth). Non-blocking: show the info
      // banner and let the user continue on to the version rather than treating this
      // as a dead end.
      setNoGitSync(true);
      setCreatedVersionId(result.data.version.id);
      return;
    }
    router.push(`/agent-platform/versions/${result.data.version.id}`);
  }

  return (
    <div>
      <p className="mb-2 text-sm text-muted-foreground">
        Agent Platform &gt; Definitions &gt; {definitionName} &gt; New Version
      </p>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">Create Version {version}</h1>
        <NextLink href={`/agent-platform/definitions/${definitionId}/versions/studio`} className="text-sm text-primary underline">
          Prefer a guided wizard? Try the Design Studio →
        </NextLink>
      </div>

      {fromVersionId && (
        <Alert className="mb-4">
          <AlertDescription>
            Restoring content from an earlier version — this creates a brand-new version with that content; the earlier version itself is
            unchanged. Review before creating.
          </AlertDescription>
        </Alert>
      )}

      {gitUnavailable && (
        <Alert variant="warning" className="mb-4">
          <AlertDescription>Git connection unavailable — reconnect in Settings. Your work below has not been lost.</AlertDescription>
        </Alert>
      )}

      {noGitSync && createdVersionId && (
        <Alert variant="warning" className="mb-4">
          <AlertTitle>Version saved — not synced to Git</AlertTitle>
          <AlertDescription>
            This version was saved to NextBot, but no Git connection is configured for this tenant yet, so it wasn&apos;t
            committed to a Git remote. Diff and PR/MR review won&apos;t be available for it until one is connected in{" "}
            <NextLink href="/settings/integrations">Settings &gt; Integrations</NextLink>. A teammate other than you can
            still review and approve it in-app.{" "}
            <NextLink href={`/agent-platform/versions/${createdVersionId}`}>Continue to version {version} &rarr;</NextLink>
          </AlertDescription>
        </Alert>
      )}

      <div className="mb-6 flex items-start gap-4">
        <div className="max-w-[160px]">
          <div className="mb-1 flex items-center gap-1">
            <Label htmlFor="version-editor-version">Version</Label>
            <FieldHint id="version-editor-version-hint" content="A version label for this immutable snapshot of the agent definition (e.g. semver 0.1.0) — once created, this version's artifact can never be edited in place, only superseded by a new version." />
          </div>
          <Input id="version-editor-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="0.1.0" />
        </div>
        <div className="max-w-[260px]">
          <div className="mb-1 flex items-center gap-1">
            <Label htmlFor="version-editor-graph-type">Graph Type</Label>
            <FieldHint id="version-editor-graph-type-hint" content="Which orchestration engine runs this agent — LangGraph and PydanticAI are shown for reference but aren't installed yet, so a version using either can't be promoted to Production." />
          </div>
          <Select value={graphType} onValueChange={(v) => v !== null && setGraphType(v)}>
            <SelectTrigger id="version-editor-graph-type" className="w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRAPH_TYPES.map((g) => (
                <SelectItem key={g.value} value={g.value}>
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="max-w-[260px]">
          <div className="mb-1 flex items-center gap-1">
            <Label htmlFor="version-editor-model-route">Model Route Key</Label>
            <FieldHint id="version-editor-model-route-hint" content="Which Model Gateway route this version's agent calls at runtime — configure the route itself (provider chain, cache mode, timeout) on the Model Gateway screen." />
          </div>
          <Select value={modelRouteKey} onValueChange={(v) => v !== null && setModelRouteKey(v)}>
            <SelectTrigger id="version-editor-model-route" className="w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROUTE_KEYS.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-2 font-medium">Definition YAML</p>
          {/* Phase 9 — Design/Text mode toggle. Both `TabsTrigger`/`TabsContent` pairs
              carry explicit, literal `id`/`panelId` values (never a framework-generated
              default), matching `ModelGateway.tsx`'s established convention: this
              screen's own Restore pre-fill (`setYamlText` from an async fetch) and
              Design mode's own field-loading path both shift the surrounding tree shape
              between the server render and the client's hydration pass, which is
              exactly the condition `tabs.tsx`'s doc comment documents as unsafe for
              Base UI's internally-generated ids. */}
          <Tabs defaultValue="text">
            <TabsList aria-label="Version editor mode" className="mb-2">
              <TabsTrigger id="version-editor-tab-text" panelId="version-editor-panel-text" value="text">
                Text
              </TabsTrigger>
              <TabsTrigger id="version-editor-tab-design" panelId="version-editor-panel-design" value="design">
                Design
              </TabsTrigger>
            </TabsList>

            <TabsContent id="version-editor-panel-text" value="text">
              <Textarea
                value={yamlText}
                onChange={(e) => setYamlText(e.target.value)}
                className="min-h-[500px] font-mono text-sm"
                aria-label="Agent definition YAML editor"
                aria-describedby={errors.length > 0 ? "yaml-validation-errors" : undefined}
              />
            </TabsContent>

            <TabsContent id="version-editor-panel-design" value="design">
              <DesignModeForm definitionName={definitionName} version={version} yamlText={yamlText} onYamlChange={setYamlText} />
            </TabsContent>
          </Tabs>
        </div>

        {errors.length > 0 && (
          <Alert variant="destructive" id="yaml-validation-errors" aria-live="polite">
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

        <p className="text-sm text-muted-foreground">
          The Eval Suite binding is a separate control on the version detail screen once this version is created — this is what actually gates
          promotion; the YAML&apos;s own <code>evalSuite</code> field is descriptive only.
        </p>

        <div>
          <Button onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? "Creating…" : "Create Version"}
          </Button>
        </div>
      </div>
    </div>
  );
}
