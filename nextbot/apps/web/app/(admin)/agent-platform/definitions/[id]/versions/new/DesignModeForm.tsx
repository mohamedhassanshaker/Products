"use client";

import { useEffect, useMemo, useState } from "react";
import yaml from "js-yaml";
import { useForm, Controller } from "react-hook-form";
import { typeboxResolver } from "@hookform/resolvers/typebox";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { AgentDefinitionArtifactSchema, GraphType, type AgentDefinitionArtifact, type GraphTypeValue } from "@nextbot/contracts";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { Checkbox } from "@nextbot/ui/components/ui/checkbox";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Alert, AlertDescription, AlertTitle } from "@nextbot/ui/components/ui/alert";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@nextbot/ui/components/ui/form";
import { humanizeFieldError } from "@/src/lib/humanize-field-error";
import { humanizeYamlParseError } from "@/src/lib/humanize-yaml-error";
import { fetchJson } from "@/src/lib/fetch-json";
import { GRAPH_TYPES, ROUTE_KEYS } from "./version-editor-constants";

/**
 * FR-ESC-01's escalation-reason vocabulary (`PRODUCT_SPECIFICATION.md` §"Escalation",
 * `LLD.md` §"escalation_event" field table, `escalation-routing.ts`'s
 * `EscalationReasonValue`, and this same set already surfaced to admins in
 * `RoutingConfig.tsx`'s `REASON_OPTIONS`). `AgentDefinitionArtifactSchema.spec.
 * guardrails.escalateOn` itself is typed as a bare `Type.Array(Type.String())` (no
 * enum constraint at the contract level), but every other place this app presents
 * escalation reasons to a human uses exactly these four literals — reusing them here
 * rather than inventing a separate vocabulary for this one form.
 */
const ESCALATION_REASONS: Array<{ value: string; label: string }> = [
  { value: "LowConfidence", label: "Low confidence" },
  { value: "ToolFailure", label: "Tool failure" },
  { value: "CustomerRequest", label: "Customer request" },
  { value: "SensitiveTopic", label: "Sensitive topic" },
];

/**
 * The only memory strategy referenced anywhere in this codebase (`LLD.md`'s own
 * example artifact, `scripts/seed.ts`, every fixture in
 * `packages/modules/agent-platform`'s test suites) — `spec.memory.strategy` is a bare
 * `Type.String()` at the contract level with no enum, but no second strategy is
 * documented or implemented by the runtime anywhere, so this dropdown offers exactly
 * the one real option rather than inventing untested alternatives.
 */
const MEMORY_STRATEGIES = [{ value: "rolling-window", label: "Rolling window" }];

/**
 * Flattened, form-shaped view of `AgentDefinitionArtifact["spec"]` (metadata is
 * handled separately — see `formValuesToArtifact`'s second argument — since this
 * screen's top-of-page "Version" field is already the single control for
 * `metadata.version`/the definition's own name already drives `metadata.name`;
 * duplicating editable inputs for them here would just be a second, divergent path to
 * the same two values). `toolPolicyCapabilityGroups` is a `string[]` of real
 * `capability_group.name` values (Phase 10, client-feedback-batch item 8) — the exact
 * same shape `AgentDefinitionArtifactSchema.spec.toolPolicy.capabilityGroups` already
 * expects, so no contract change was needed to replace the prior comma-separated
 * free-text field with a picker sourced from the tenant's real capability groups.
 */
export interface DesignFormValues {
  graphType: GraphTypeValue;
  modelRoute: string;
  instructions: string;
  toolPolicyCapabilityGroups: string[];
  toolPolicyMaxToolCallsPerTurn: number;
  guardrailsMinConfidenceForAutonomy: number;
  guardrailsEscalateOn: string[];
  memoryStrategy: string;
  memoryMaxTurns: number;
  evalSuite: string;
  budgetsMaxCostUsdPerConversation: string;
  budgetsMaxLatencyMsP95: number;
}

/** TypeBox schema for `DesignFormValues` — a distinct schema from
 * `AgentDefinitionArtifactSchema` (that one validates the nested artifact shape; this
 * one validates the flattened form shape RHF actually holds), passed to the same
 * `@hookform/resolvers/typebox` resolver `ConnectorWizard.tsx` already established as
 * this codebase's RHF-form validation convention (ADR-0002 §4). */
const DesignFormValuesSchema = Type.Object({
  graphType: GraphType,
  modelRoute: Type.String({ minLength: 1 }),
  instructions: Type.String({ minLength: 1 }),
  toolPolicyCapabilityGroups: Type.Array(Type.String()),
  toolPolicyMaxToolCallsPerTurn: Type.Integer({ minimum: 1 }),
  guardrailsMinConfidenceForAutonomy: Type.Number({ minimum: 0, maximum: 1 }),
  guardrailsEscalateOn: Type.Array(Type.String()),
  memoryStrategy: Type.String({ minLength: 1 }),
  memoryMaxTurns: Type.Integer({ minimum: 1 }),
  evalSuite: Type.String(),
  budgetsMaxCostUsdPerConversation: Type.String({ minLength: 1 }),
  budgetsMaxLatencyMsP95: Type.Integer({ minimum: 0 }),
});
// `DesignFormValuesSchema`'s own `Static<>` type is deliberately not aliased/asserted
// against `DesignFormValues` here — the resolver only needs the schema at runtime,
// and the two are kept in sync by hand (each field above mirrors one line in
// `DesignFormValues`), the same relationship `AgentDefinitionArtifactSchema` and its
// own `AgentDefinitionArtifact` type already have in `@nextbot/contracts`.

/**
 * Pure function: full `AgentDefinitionArtifact` -> this form's flattened field shape.
 * Drops `apiVersion`/`kind`/`metadata` (see `DesignFormValues`'s doc comment for why
 * metadata isn't part of this form) and `toolPolicy.source` (the schema pins it to the
 * single literal `"agent-tool-registry"` — there is nothing for a user to choose).
 * Exported for the round-trip unit tests required by this phase's own acceptance
 * criteria, and reused by `DesignModeForm` itself to seed the form's `defaultValues`.
 */
export function artifactToFormValues(artifact: AgentDefinitionArtifact): DesignFormValues {
  return {
    graphType: artifact.spec.graphType,
    modelRoute: artifact.spec.modelRoute,
    instructions: artifact.spec.instructions,
    toolPolicyCapabilityGroups: [...artifact.spec.toolPolicy.capabilityGroups],
    toolPolicyMaxToolCallsPerTurn: artifact.spec.toolPolicy.maxToolCallsPerTurn,
    guardrailsMinConfidenceForAutonomy: artifact.spec.guardrails.minConfidenceForAutonomy,
    guardrailsEscalateOn: [...artifact.spec.guardrails.escalateOn],
    memoryStrategy: artifact.spec.memory.strategy,
    memoryMaxTurns: artifact.spec.memory.maxTurns,
    evalSuite: artifact.spec.evalSuite ?? "",
    budgetsMaxCostUsdPerConversation: artifact.spec.budgets.maxCostUsdPerConversation,
    budgetsMaxLatencyMsP95: artifact.spec.budgets.maxLatencyMsP95,
  };
}

/**
 * Pure function: this form's flattened field shape -> a full `AgentDefinitionArtifact`
 * — the inverse of `artifactToFormValues`. `metadata` is threaded through explicitly
 * (rather than being part of `DesignFormValues`) since this screen's top-of-page
 * "Version" input and the resolved definition name are the single source of truth for
 * `metadata.version`/`metadata.name`, exactly as the Text-mode `SCAFFOLD` template
 * already establishes. An empty `evalSuite` string round-trips back to `undefined`
 * (the schema's `Type.Optional`), matching how `Value.Check` already treats an absent
 * `evalSuite` key as valid — never emitting a spurious empty string into the artifact.
 */
export function formValuesToArtifact(values: DesignFormValues, metadata: { name: string; version: string }): AgentDefinitionArtifact {
  return {
    apiVersion: "nextbot.io/v1",
    kind: "AgentDefinition",
    metadata: { name: metadata.name, version: metadata.version },
    spec: {
      graphType: values.graphType,
      modelRoute: values.modelRoute,
      instructions: values.instructions,
      toolPolicy: {
        source: "agent-tool-registry",
        capabilityGroups: values.toolPolicyCapabilityGroups,
        maxToolCallsPerTurn: values.toolPolicyMaxToolCallsPerTurn,
      },
      guardrails: {
        minConfidenceForAutonomy: values.guardrailsMinConfidenceForAutonomy,
        escalateOn: values.guardrailsEscalateOn,
      },
      memory: {
        strategy: values.memoryStrategy,
        maxTurns: values.memoryMaxTurns,
      },
      evalSuite: values.evalSuite === "" ? undefined : values.evalSuite,
      budgets: {
        maxCostUsdPerConversation: values.budgetsMaxCostUsdPerConversation,
        maxLatencyMsP95: values.budgetsMaxLatencyMsP95,
      },
    },
  };
}

/** One row from `GET /api/v1/admin/tools/capability-groups` (Phase 10,
 * client-feedback-batch item 8) — the tenant's real `capability_group` table, each
 * with a live count of member tools. */
export interface CapabilityGroupOption {
  id: string;
  name: string;
  guidanceText: string | null;
  toolCount: number;
}

/** A blank, schema-valid starting point for Design mode when the current Text-mode
 * YAML can't be parsed/doesn't validate — mirrors `VersionEditor.tsx`'s own `SCAFFOLD`
 * defaults (ADK / chat.primary / rolling-window) rather than inventing different
 * defaults for the same "brand-new version" starting state. */
function blankFormValues(): DesignFormValues {
  return {
    graphType: "ADK",
    modelRoute: "chat.primary",
    instructions: "You are a helpful support agent.",
    toolPolicyCapabilityGroups: [],
    toolPolicyMaxToolCallsPerTurn: 5,
    guardrailsMinConfidenceForAutonomy: 0.6,
    guardrailsEscalateOn: [],
    memoryStrategy: "rolling-window",
    memoryMaxTurns: 20,
    evalSuite: "",
    budgetsMaxCostUsdPerConversation: "0.50",
    budgetsMaxLatencyMsP95: 6000,
  };
}

/** Attempts to derive `DesignFormValues` from the current Text-mode YAML, running it
 * through the exact same parse-then-validate sequence `VersionEditor.tsx`'s own
 * `validate()` uses (`yaml.load` -> `Value.Check` against `AgentDefinitionArtifactSchema`)
 * — deliberately not a second, parallel validation path. Returns a human-readable error
 * list instead of throwing, so a not-yet-valid Text-mode draft doesn't crash Design mode
 * when a user switches tabs mid-edit. */
function loadFormValuesFromYaml(yamlText: string): { values: DesignFormValues; errors: null } | { values: null; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = yaml.load(yamlText);
  } catch (err) {
    return { values: null, errors: [humanizeYamlParseError(err)] };
  }
  if (!Value.Check(AgentDefinitionArtifactSchema, parsed)) {
    const errs = [...Value.Errors(AgentDefinitionArtifactSchema, parsed)].map((e) => `${e.path}: ${e.message}`);
    return { values: null, errors: errs };
  }
  return { values: artifactToFormValues(parsed as AgentDefinitionArtifact), errors: null };
}

/**
 * Phase 9 (client-feedback-batch item 7) — "Design mode": a structured form over
 * `AgentDefinitionArtifactSchema`'s `spec`, generating/parsing the identical YAML Text
 * mode edits so either mode can be used interchangeably on the same version. Not a
 * visual node-graph canvas (BL-16, a separate, unbuilt future item).
 *
 * Sync model: `Tabs`/`TabsContent` (see `VersionEditor.tsx`) unmount their inactive
 * panel by default (`tabs.tsx`'s doc comment), so this component naturally re-derives
 * its form state from `yamlText` fresh on every mount (i.e. every time a user switches
 * into the Design tab) rather than needing a `useEffect` that re-syncs on every parent
 * re-render. Only actual field edits push a freshly serialized YAML string back up via
 * `onYamlChange` (via `form.watch`'s change-subscription callback, which does not fire
 * on the initial render) — so merely switching into Design mode and back to Text mode
 * without touching any field leaves the original YAML text byte-for-byte untouched.
 */
export function DesignModeForm({
  definitionName,
  version,
  yamlText,
  onYamlChange,
}: {
  /** The parent agent definition's name — feeds `metadata.name` on every artifact this
   * form produces (see `formValuesToArtifact`'s doc comment for why this isn't a
   * separate editable field in this form). */
  definitionName: string;
  /** The screen's top-of-page "Version" field value — feeds `metadata.version`, same
   * rationale as `definitionName` above. */
  version: string;
  /** The current Text-mode YAML — this form's only source of initial state. */
  yamlText: string;
  /** Called with a freshly serialized YAML string whenever a field in this form
   * changes (never on mount — see this component's own doc comment). */
  onYamlChange: (yamlText: string) => void;
}) {
  const loaded = useMemo(() => loadFormValuesFromYaml(yamlText), [yamlText]);
  const initialValues = loaded.values ?? blankFormValues();

  // Phase 10 (client-feedback-batch item 8): the tenant's real capability groups,
  // fetched once per mount for the Tool Policy picker below. `null` = still loading
  // (renders a `Skeleton`, matching this app's established loading-state convention —
  // see `field-hint.test.tsx`'s hydration-mismatch note on why a `<Skeleton>`
  // conditional here is expected, not a defect); an empty array after a failed fetch
  // never blocks the rest of this form — a picker with zero options plus the
  // already-selected names (see `capabilityGroupOptions` below) still lets an existing
  // artifact's groups be edited/removed, just not newly picked from a live list until
  // the fetch succeeds.
  const [capabilityGroups, setCapabilityGroups] = useState<CapabilityGroupOption[] | null>(null);
  const [capabilityGroupsError, setCapabilityGroupsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ capabilityGroups: CapabilityGroupOption[] }>("/api/v1/admin/tools/capability-groups").then((r) => {
      if (cancelled) return;
      if (r.kind !== "ok") {
        setCapabilityGroupsError(true);
        setCapabilityGroups([]);
        return;
      }
      setCapabilityGroups(r.data.capabilityGroups);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const form = useForm<DesignFormValues>({
    resolver: typeboxResolver(DesignFormValuesSchema),
    defaultValues: initialValues,
    // Unlike `ConnectorWizard.tsx` (which only validates at its own explicit submit
    // step), this form has no submit button of its own — its only "commit" point is
    // the change-subscription effect below, which silently withholds propagating an
    // invalid artifact rather than surfacing per-field errors. Validating `onChange`
    // means a field the guard above is quietly rejecting also shows the user *why*
    // (via `FormMessage`/`humanizeFieldError`) instead of just never reaching Text
    // mode with no visible explanation.
    mode: "onChange",
  });

  useEffect(() => {
    // Fires on every field change after mount, never on the initial render itself
    // (react-hook-form's `watch(callback)` form only invokes the callback on
    // subsequent changes) — see this component's top-level doc comment for why that
    // matters (no unsolicited YAML reformatting just from switching tabs).
    const subscription = form.watch((values) => {
      const candidate = values as DesignFormValues;
      const artifact = formValuesToArtifact(candidate, { name: definitionName, version });
      // Guards against propagating a half-typed, not-yet-valid artifact (e.g. a
      // momentarily empty required field mid-keystroke) up into the shared
      // `yamlText` state that Text mode and the submit-time `validate()` both read.
      if (Value.Check(AgentDefinitionArtifactSchema, artifact)) {
        onYamlChange(yaml.dump(artifact));
      }
    });
    return () => subscription.unsubscribe();
    // Deliberately an empty dependency array (no `react-hooks/exhaustive-deps` rule is
    // configured in this repo's `eslint.config.mjs`, so this isn't overriding a lint
    // rule): `form` is stable for this component's lifetime (a new `form` only exists
    // after a full remount, which already re-seeds `defaultValues` from a fresh
    // `yamlText`); `onYamlChange`/`definitionName`/`version` are read fresh via closure
    // on every call to the `watch` callback regardless, so re-running this effect on
    // their change would only matter for a *future* keystroke, never for correctness
    // of the current one.
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {loaded.errors && (
        <Alert variant="warning">
          <AlertTitle>Starting from defaults — the current Text mode content doesn&apos;t parse</AlertTitle>
          <AlertDescription>
            <p className="mb-2">
              Switch back to the Text tab to fix these errors, or keep editing below — nothing here is written back to Text mode until you
              change a field.
            </p>
            <ul className="flex flex-col gap-1 ps-6">
              {loaded.errors.map((e, i) => (
                <li key={i} className="text-sm">
                  {e}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Form {...form}>
        <form className="flex flex-col gap-8" onSubmit={(e) => e.preventDefault()}>
          <section className="flex flex-col gap-4">
            <h2 className="font-heading text-sm font-semibold">Graph &amp; Model</h2>

            <FormField
              control={form.control}
              name="graphType"
              render={({ field, fieldState }) => (
                <FormItem className="max-w-[320px]">
                  <div className="flex items-center gap-1">
                    <FormLabel>Graph type</FormLabel>
                    <FieldHint
                      id="design-graph-type-hint"
                      content="Which orchestration engine runs this agent — LangGraph and PydanticAI are shown for reference but aren't installed yet, so a version using either can't be promoted to Production."
                    />
                  </div>
                  <Select value={field.value} onValueChange={(v) => v !== null && field.onChange(v)}>
                    <FormControl>
                      <SelectTrigger aria-label="Graph type">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {GRAPH_TYPES.map((g) => (
                        <SelectItem key={g.value} value={g.value}>
                          {g.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage>{humanizeFieldError("graphType", fieldState.error?.message)}</FormMessage>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="modelRoute"
              render={({ field, fieldState }) => (
                <FormItem className="max-w-[320px]">
                  <div className="flex items-center gap-1">
                    <FormLabel>Model route</FormLabel>
                    <FieldHint
                      id="design-model-route-hint"
                      content="Which Model Gateway route this version's agent calls at runtime — configure the route itself (provider chain, cache mode, timeout) on the Model Gateway screen."
                    />
                  </div>
                  <Select value={field.value} onValueChange={(v) => v !== null && field.onChange(v)}>
                    <FormControl>
                      <SelectTrigger aria-label="Model route">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ROUTE_KEYS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {k}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage>{humanizeFieldError("modelRoute", fieldState.error?.message)}</FormMessage>
                </FormItem>
              )}
            />
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="font-heading text-sm font-semibold">Instructions</h2>
            <FormField
              control={form.control}
              name="instructions"
              render={({ field, fieldState }) => (
                <FormItem>
                  <div className="flex items-center gap-1">
                    <FormLabel>System instructions</FormLabel>
                    <FieldHint
                      id="design-instructions-hint"
                      content="The system prompt this agent runs with — the primary lever for its tone, scope, and behavior."
                    />
                  </div>
                  <FormControl>
                    <Textarea {...field} className="min-h-[160px] font-mono text-sm" />
                  </FormControl>
                  <FormMessage>{humanizeFieldError("instructions", fieldState.error?.message)}</FormMessage>
                </FormItem>
              )}
            />
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="font-heading text-sm font-semibold">Tool Policy</h2>
            <Controller
              control={form.control}
              name="toolPolicyCapabilityGroups"
              render={({ field }) => {
                // Union of the tenant's real, currently-fetched capability groups and
                // any name already selected on this artifact that no longer matches a
                // real row (a deleted/renamed group, or — defensively — a stale name
                // from before this picker existed). Surfacing the orphan rather than
                // silently dropping it means switching into Design mode never loses
                // data the artifact already had; the "no longer exists" label lets an
                // admin consciously remove it instead.
                const selected = field.value ?? [];
                const realNames = new Set((capabilityGroups ?? []).map((g) => g.name));
                const orphanedSelections = selected.filter((name) => !realNames.has(name));
                return (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1 flex items-center gap-1 text-sm font-medium">
                      Capability groups
                      <FieldHint
                        id="design-capability-groups-hint"
                        content="Which real Tool Registry capability groups (LLD §3.6) this agent's tool calls are restricted to — a tool with no group assigned is unaffected by this list. Configure groups themselves on the Tool Registry screen."
                      />
                    </legend>
                    {capabilityGroups === null ? (
                      <div className="flex flex-col gap-2" role="status" aria-label="Loading capability groups">
                        <Skeleton className="h-5 w-48" />
                        <Skeleton className="h-5 w-40" />
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {capabilityGroupsError && (
                          <p className="text-sm text-muted-foreground">
                            Couldn&apos;t load capability groups from the Tool Registry — you can still remove an already-selected group below,
                            but new groups can&apos;t be picked until this reloads.
                          </p>
                        )}
                        {capabilityGroups.length === 0 && orphanedSelections.length === 0 && !capabilityGroupsError && (
                          <p className="text-sm text-muted-foreground">
                            No capability groups configured for this tenant yet — every tool is available to this agent regardless of this
                            setting until one is created on the Tool Registry screen.
                          </p>
                        )}
                        {/* Phase 17 (client-feedback-batch capability-group enforcement): distinct from the
                            "tenant has zero groups at all" message above — this is the equally-common case
                            where real groups exist but this agent simply hasn't picked any of them yet. Left
                            unselected, this agent's tool calls are NOT restricted by capability group at all
                            (every tool remains available, same as before this restriction existed) — worth
                            saying explicitly, since the field hint above ("...tool calls are restricted to...")
                            could otherwise read as "restricted to nothing selected" (i.e. deny-all), which is
                            the opposite of the real runtime behavior. */}
                        {capabilityGroups.length > 0 && selected.length === 0 && orphanedSelections.length === 0 && !capabilityGroupsError && (
                          <p className="text-sm text-muted-foreground">
                            No capability groups selected — this agent&apos;s tool calls are unrestricted by capability group (every tool
                            remains available, subject to the Tool Registry&apos;s own visibility/permission rules).
                          </p>
                        )}
                        {capabilityGroups.map((group) => {
                          const checked = selected.includes(group.name);
                          const checkboxId = `design-capability-group-${group.id}`;
                          return (
                            <div key={group.id} className="flex items-center gap-2">
                              <Checkbox
                                id={checkboxId}
                                checked={checked}
                                onCheckedChange={(next) =>
                                  field.onChange(next === true ? [...selected, group.name] : selected.filter((n) => n !== group.name))
                                }
                              />
                              <Label htmlFor={checkboxId}>
                                {group.name}{" "}
                                <span className="text-muted-foreground">
                                  ({group.toolCount} tool{group.toolCount === 1 ? "" : "s"})
                                </span>
                              </Label>
                            </div>
                          );
                        })}
                        {orphanedSelections.map((name) => {
                          const checkboxId = `design-capability-group-orphan-${name}`;
                          return (
                            <div key={name} className="flex items-center gap-2">
                              <Checkbox
                                id={checkboxId}
                                checked={true}
                                onCheckedChange={(next) => next !== true && field.onChange(selected.filter((n) => n !== name))}
                              />
                              <Label htmlFor={checkboxId}>
                                {name} <span className="text-muted-foreground">(no longer exists — untick to remove)</span>
                              </Label>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </fieldset>
                );
              }}
            />
            <FormField
              control={form.control}
              name="toolPolicyMaxToolCallsPerTurn"
              render={({ field, fieldState }) => (
                <FormItem className="max-w-[200px]">
                  <div className="flex items-center gap-1">
                    <FormLabel>Max tool calls per turn</FormLabel>
                    <FieldHint id="design-max-tool-calls-hint" content="Hard ceiling on how many tool calls this agent can make while producing a single reply." />
                  </div>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={field.value}
                      onChange={(e) => field.onChange(e.target.value === "" ? "" : Number(e.target.value))}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormMessage>{humanizeFieldError("toolPolicyMaxToolCallsPerTurn", fieldState.error?.message)}</FormMessage>
                </FormItem>
              )}
            />
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="font-heading text-sm font-semibold">Guardrails</h2>
            <FormField
              control={form.control}
              name="guardrailsMinConfidenceForAutonomy"
              render={({ field, fieldState }) => (
                <FormItem className="max-w-[200px]">
                  <div className="flex items-center gap-1">
                    <FormLabel>Min confidence for autonomy</FormLabel>
                    <FieldHint
                      id="design-min-confidence-hint"
                      content="The minimum recognized-goal confidence (0 to 1) below which the agent must escalate to a human instead of replying autonomously (FR-ESC-01)."
                    />
                  </div>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={field.value}
                      onChange={(e) => field.onChange(e.target.value === "" ? "" : Number(e.target.value))}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormMessage>{humanizeFieldError("guardrailsMinConfidenceForAutonomy", fieldState.error?.message)}</FormMessage>
                </FormItem>
              )}
            />

            <Controller
              control={form.control}
              name="guardrailsEscalateOn"
              render={({ field }) => (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 flex items-center gap-1 text-sm font-medium">
                    Escalate on
                    <FieldHint
                      id="design-escalate-on-hint"
                      content="Which escalation reasons (FR-ESC-01) this agent's own guardrails can raise, in addition to the mandatory low-confidence trigger the runtime always enforces."
                    />
                  </legend>
                  <div className="flex flex-col gap-2">
                    {ESCALATION_REASONS.map((reason) => {
                      const checked = field.value?.includes(reason.value) ?? false;
                      const checkboxId = `design-escalate-on-${reason.value}`;
                      return (
                        <div key={reason.value} className="flex items-center gap-2">
                          <Checkbox
                            id={checkboxId}
                            checked={checked}
                            onCheckedChange={(next) => {
                              const current = field.value ?? [];
                              field.onChange(next === true ? [...current, reason.value] : current.filter((r) => r !== reason.value));
                            }}
                          />
                          <Label htmlFor={checkboxId}>{reason.label}</Label>
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
              )}
            />
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="font-heading text-sm font-semibold">Memory</h2>
            <FormField
              control={form.control}
              name="memoryStrategy"
              render={({ field, fieldState }) => (
                <FormItem className="max-w-[240px]">
                  <div className="flex items-center gap-1">
                    <FormLabel>Strategy</FormLabel>
                    <FieldHint id="design-memory-strategy-hint" content="How this agent's conversation memory is windowed — rolling window is the only strategy this runtime currently implements." />
                  </div>
                  <Select value={field.value} onValueChange={(v) => v !== null && field.onChange(v)}>
                    <FormControl>
                      <SelectTrigger aria-label="Memory strategy">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {MEMORY_STRATEGIES.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage>{humanizeFieldError("memoryStrategy", fieldState.error?.message)}</FormMessage>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="memoryMaxTurns"
              render={({ field, fieldState }) => (
                <FormItem className="max-w-[200px]">
                  <div className="flex items-center gap-1">
                    <FormLabel>Max turns</FormLabel>
                    <FieldHint id="design-memory-max-turns-hint" content="How many recent conversation turns stay in the agent's rolling memory window." />
                  </div>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={field.value}
                      onChange={(e) => field.onChange(e.target.value === "" ? "" : Number(e.target.value))}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormMessage>{humanizeFieldError("memoryMaxTurns", fieldState.error?.message)}</FormMessage>
                </FormItem>
              )}
            />
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="font-heading text-sm font-semibold">Eval Suite</h2>
            <FormField
              control={form.control}
              name="evalSuite"
              render={({ field, fieldState }) => (
                <FormItem className="max-w-[320px]">
                  <div className="flex items-center gap-1">
                    <FormLabel>Eval suite (descriptive)</FormLabel>
                    <FieldHint
                      id="design-eval-suite-hint"
                      content="Descriptive only — it doesn't bind an eval suite. The Eval Suite binding that actually gates promotion is a separate control on the version detail screen, once this version is created."
                    />
                  </div>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage>{humanizeFieldError("evalSuite", fieldState.error?.message)}</FormMessage>
                </FormItem>
              )}
            />
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="font-heading text-sm font-semibold">Budgets</h2>
            <FormField
              control={form.control}
              name="budgetsMaxCostUsdPerConversation"
              render={({ field, fieldState }) => (
                <FormItem className="max-w-[200px]">
                  <div className="flex items-center gap-1">
                    <FormLabel>Max cost (USD / conversation)</FormLabel>
                    <FieldHint id="design-max-cost-hint" content="The per-conversation USD cost ceiling (FR-RP-07) — exceeding it drops the agent into degraded mode instead of continuing to call the model." />
                  </div>
                  <FormControl>
                    <Input {...field} inputMode="decimal" placeholder="0.50" />
                  </FormControl>
                  <FormMessage>{humanizeFieldError("budgetsMaxCostUsdPerConversation", fieldState.error?.message)}</FormMessage>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="budgetsMaxLatencyMsP95"
              render={({ field, fieldState }) => (
                <FormItem className="max-w-[200px]">
                  <div className="flex items-center gap-1">
                    <FormLabel>Max latency P95 (ms)</FormLabel>
                    <FieldHint id="design-max-latency-hint" content="The p95 reply-latency ceiling (FR-RP-07) — exceeding it drops the agent into degraded mode instead of continuing to call the model." />
                  </div>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={field.value}
                      onChange={(e) => field.onChange(e.target.value === "" ? "" : Number(e.target.value))}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormMessage>{humanizeFieldError("budgetsMaxLatencyMsP95", fieldState.error?.message)}</FormMessage>
                </FormItem>
              )}
            />
          </section>
        </form>
      </Form>
    </div>
  );
}
