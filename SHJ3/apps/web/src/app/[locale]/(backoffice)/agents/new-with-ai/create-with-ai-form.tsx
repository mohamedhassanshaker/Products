"use client";

/**
 * `/agents/new-with-ai` — two client states in one component, no extra navigation:
 * **Describe** (one message in, one plan out) then **Review** (seven sections mirroring the
 * wizard's own step names, each pre-filled and editable/toggleable) then, on submit, a
 * **Result** checklist of what `applyAgentCreationPlanAction` actually applied — see that
 * action's own doc comment for why it stops (never rolls back) at the first group that fails.
 */

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { SelectablePill } from "@/components/ui/selectable-pill";
import { StatusCell } from "@/components/ui/status-cell";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleRow } from "@/components/ui/toggle-row";
import { Composer } from "@/components/patterns/composer/composer.js";
import {
  TONES,
  WIZARD_CHANNEL_KEYS,
  type ChannelKey,
  type Tone,
} from "../../../../../modules/agents/domain/agent.js";
import type {
  AgentCreationPlan,
  GuardrailOverrideProposal,
  ToolBindingProposal,
} from "../../../../../modules/agents/ports/agent-creation-ai-client.js";
import type {
  AgentCreationCatalogEntry,
  AgentCreationGroupOutcome,
  applyAgentCreationPlanAction,
  proposeAgentCreationAction,
} from "../actions.js";

export interface CreateWithAiFormActions {
  readonly proposeAgentCreation: typeof proposeAgentCreationAction;
  readonly applyAgentCreationPlan: typeof applyAgentCreationPlanAction;
}

export interface CreateWithAiFormProps {
  readonly actions: CreateWithAiFormActions;
}

interface ReviewCatalogs {
  readonly skills: readonly AgentCreationCatalogEntry[];
  readonly mcpTools: readonly AgentCreationCatalogEntry[];
  readonly apiConnectors: readonly AgentCreationCatalogEntry[];
  readonly guardrailPolicies: readonly { readonly policyKey: string; readonly title: string }[];
}

function catalogNameFor(catalogs: ReviewCatalogs, binding: ToolBindingProposal): string {
  const list =
    binding.targetKind === "Skill"
      ? catalogs.skills
      : binding.targetKind === "McpTool"
        ? catalogs.mcpTools
        : catalogs.apiConnectors;
  return list.find((entry) => entry.id === binding.targetId)?.name ?? binding.targetId;
}

function policyTitleFor(catalogs: ReviewCatalogs, override: GuardrailOverrideProposal): string {
  return (
    catalogs.guardrailPolicies.find((p) => p.policyKey === override.policyKey)?.title ??
    override.policyKey
  );
}

type FormState = {
  readonly name: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly tone: Tone;
  readonly primaryModel: string;
  readonly fallbackModel: string;
  readonly temperature: number;
  readonly channelKeys: readonly ChannelKey[];
  readonly guardrailOverrides: readonly GuardrailOverrideProposal[];
  readonly acceptedGuardrails: ReadonlySet<number>;
  readonly toolBindings: readonly ToolBindingProposal[];
  readonly acceptedTools: ReadonlySet<number>;
  readonly enableKnowledge: boolean;
  readonly flowInstruction: string;
};

function stateFromPlan(plan: AgentCreationPlan): FormState {
  return {
    name: plan.name,
    description: plan.description,
    systemPrompt: plan.systemPrompt,
    tone: plan.tone,
    primaryModel: plan.primaryModel,
    fallbackModel: plan.fallbackModel ?? "",
    temperature: plan.temperature,
    channelKeys: plan.channelKeys.filter((key: string): key is ChannelKey =>
      (WIZARD_CHANNEL_KEYS as readonly string[]).includes(key),
    ),
    guardrailOverrides: plan.guardrailOverrides,
    acceptedGuardrails: new Set(plan.guardrailOverrides.keys()),
    toolBindings: plan.toolBindings,
    acceptedTools: new Set(plan.toolBindings.keys()),
    enableKnowledge: plan.enableKnowledge,
    flowInstruction: plan.flowInstruction,
  };
}

export function CreateWithAiForm({ actions }: CreateWithAiFormProps): React.ReactElement {
  const t = useTranslations("agents.newWithAi");
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();

  const [businessDescription, setBusinessDescription] = React.useState("");
  const [proposing, setProposing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [plan, setPlan] = React.useState<AgentCreationPlan | null>(null);
  const [catalogs, setCatalogs] = React.useState<ReviewCatalogs | null>(null);
  const [form, setForm] = React.useState<FormState | null>(null);

  const [applying, setApplying] = React.useState(false);
  const [result, setResult] = React.useState<{
    readonly agentId: string;
    readonly groups: readonly AgentCreationGroupOutcome[];
    readonly stoppedAtGroup: string | null;
  } | null>(null);

  async function handlePropose(): Promise<void> {
    setProposing(true);
    setError(null);
    const outcome = await actions.proposeAgentCreation({ businessDescription });
    setProposing(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setPlan(outcome.value.plan);
    setCatalogs(outcome.value.catalogs);
    setForm(stateFromPlan(outcome.value.plan));
  }

  async function handleCreate(): Promise<void> {
    if (!form) return;
    setApplying(true);
    setError(null);
    const outcome = await actions.applyAgentCreationPlan({
      name: form.name,
      description: form.description.trim().length > 0 ? form.description : null,
      systemPrompt: form.systemPrompt,
      tone: form.tone,
      primaryModel: form.primaryModel,
      fallbackModel: form.fallbackModel.trim().length > 0 ? form.fallbackModel : null,
      temperature: form.temperature,
      channelKeys: form.channelKeys,
      guardrailOverrides: form.guardrailOverrides.filter((override, index) => {
        void override;
        return form.acceptedGuardrails.has(index);
      }),
      toolBindings: form.toolBindings.filter((binding, index) => {
        void binding;
        return form.acceptedTools.has(index);
      }),
      enableKnowledge: form.enableKnowledge,
      flowInstruction: form.flowInstruction,
    });
    setApplying(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setResult(outcome);
  }

  if (result) {
    return (
      <div className="flex flex-col gap-4" style={{ maxWidth: "36rem" }}>
        <ul className="flex flex-col gap-2">
          {result.groups.map((group) => {
            // A group with `total === 0` genuinely applied nothing because nothing was
            // proposed/accepted for it (e.g. no tool bindings, or the flow-authoring call
            // returned zero operations) — that is a real, honest outcome, but visually
            // indistinguishable from "N/N applied" if rendered the same green as a real
            // success. Rendered neutral instead, so an empty flow/tool list never reads as
            // a completed one.
            const isVacuous = group.ok && group.total === 0;
            const family = !group.ok ? "destructive" : isVacuous ? "neutral" : "success";
            return (
              <li key={group.group} className="flex items-center gap-2">
                <StatusCell
                  label={t(`resultGroup.${group.group}`)}
                  family={family}
                  rank={!group.ok ? 1 : isVacuous ? 0.5 : 0}
                />
                {group.total !== undefined ? (
                  <span className="text-xs text-muted-foreground">
                    {t("resultAppliedCount", { count: group.appliedCount ?? 0, total: group.total })}
                  </span>
                ) : null}
                {group.detail ? (
                  <span className="text-xs text-muted-foreground">{group.detail}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
        {result.stoppedAtGroup ? (
          <InlineAlert variant="warning">{t("resultPartialNotice")}</InlineAlert>
        ) : (
          <InlineAlert variant="success">{t("resultSuccessNotice")}</InlineAlert>
        )}
        <div>
          <Button
            type="button"
            onClick={() => router.push(`/${locale}/agents/${result.agentId}/edit`)}
          >
            {t("continueInWizardAction")}
          </Button>
        </div>
      </div>
    );
  }

  if (!plan || !form || !catalogs) {
    return (
      <div className="flex flex-col gap-4" style={{ maxWidth: "36rem" }}>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
        <Composer
          value={businessDescription}
          onValueChange={setBusinessDescription}
          onSend={() => void handlePropose()}
          status={proposing ? { type: "sending" } : { type: "idle" }}
          placeholder={t("descriptionPlaceholder")}
          ariaLabel={t("descriptionAriaLabel")}
          sendLabel={t("generateAction")}
        />
      </div>
    );
  }

  function toggleGuardrail(index: number): void {
    setForm((current) => {
      if (!current) return current;
      const accepted = new Set(current.acceptedGuardrails);
      if (accepted.has(index)) accepted.delete(index);
      else accepted.add(index);
      return { ...current, acceptedGuardrails: accepted };
    });
  }

  function toggleTool(index: number): void {
    setForm((current) => {
      if (!current) return current;
      const accepted = new Set(current.acceptedTools);
      if (accepted.has(index)) accepted.delete(index);
      else accepted.add(index);
      return { ...current, acceptedTools: accepted };
    });
  }

  return (
    <div className="flex flex-col gap-8" style={{ maxWidth: "42rem" }}>
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
      {plan.warnings.length > 0 ? (
        <InlineAlert variant="warning">{plan.warnings.join(" ")}</InlineAlert>
      ) : null}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">{t("section.identity")}</h2>
        <FormField label={t("nameLabel")}>
          {(field) => (
            <Input
              {...field}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          )}
        </FormField>
        <FormField label={t("descriptionLabel")}>
          {(field) => (
            <Textarea
              {...field}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
            />
          )}
        </FormField>
        <FormField label={t("systemPromptLabel")}>
          {(field) => (
            <Textarea
              {...field}
              value={form.systemPrompt}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              rows={5}
            />
          )}
        </FormField>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-foreground">{t("toneLabel")}</span>
          <ToggleRow
            aria-label={t("toneLabel")}
            value={form.tone}
            onValueChange={(value: string) => setForm({ ...form, tone: value as Tone })}
            options={TONES.map((value) => ({ value, label: t(`tone.${value}`) }))}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">{t("section.model")}</h2>
        <FormField label={t("primaryModelLabel")}>
          {(field) => (
            <Input
              {...field}
              dir="ltr"
              variant="mono"
              value={form.primaryModel}
              onChange={(e) => setForm({ ...form, primaryModel: e.target.value })}
              required
            />
          )}
        </FormField>
        <FormField label={t("fallbackModelLabel")}>
          {(field) => (
            <Input
              {...field}
              dir="ltr"
              variant="mono"
              value={form.fallbackModel}
              onChange={(e) => setForm({ ...form, fallbackModel: e.target.value })}
            />
          )}
        </FormField>
        <FormField label={t("temperatureLabel")}>
          {(field) => (
            <Input
              {...field}
              type="number"
              variant="mono"
              min={0}
              max={2}
              step={0.1}
              value={form.temperature}
              onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })}
            />
          )}
        </FormField>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">{t("section.tools")}</h2>
        {form.toolBindings.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noToolsProposed")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {form.toolBindings.map((binding, index) => (
              <li key={index} className="flex items-start gap-2">
                <Checkbox
                  checked={form.acceptedTools.has(index)}
                  onCheckedChange={() => toggleTool(index)}
                  aria-label={catalogNameFor(catalogs, binding)}
                />
                <span className="flex flex-col">
                  <span className="text-xs font-medium text-foreground">
                    {catalogNameFor(catalogs, binding)}
                  </span>
                  <span className="text-2xs text-muted-foreground">
                    {t(`assurance.${binding.requiredAssurance}`)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium text-foreground">{t("section.knowledge")}</h2>
        <Switch
          checked={form.enableKnowledge}
          onCheckedChange={(checked) => setForm({ ...form, enableKnowledge: checked })}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">{t("section.guardrails")}</h2>
        {form.guardrailOverrides.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noGuardrailsProposed")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {form.guardrailOverrides.map((override, index) => (
              <li key={index} className="flex items-start gap-2">
                <Checkbox
                  checked={form.acceptedGuardrails.has(index)}
                  onCheckedChange={() => toggleGuardrail(index)}
                  aria-label={policyTitleFor(catalogs, override)}
                />
                <span className="flex flex-col">
                  <span className="text-xs font-medium text-foreground">
                    {policyTitleFor(catalogs, override)}
                  </span>
                  <span className="text-2xs text-muted-foreground">{override.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">{t("section.channels")}</h2>
        <div className="flex flex-wrap gap-2">
          {WIZARD_CHANNEL_KEYS.map((key) => (
            <SelectablePill
              key={key}
              variant="multi"
              checked={form.channelKeys.includes(key)}
              onCheckedChange={(checked) =>
                setForm({
                  ...form,
                  channelKeys: checked
                    ? [...form.channelKeys, key]
                    : form.channelKeys.filter((k) => k !== key),
                })
              }
            >
              {t(`channel.${key}`)}
            </SelectablePill>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">{t("section.flow")}</h2>
        <FormField label={t("flowInstructionLabel")} help={t("flowInstructionHelp")}>
          {(field) => (
            <Textarea
              {...field}
              value={form.flowInstruction}
              onChange={(e) => setForm({ ...form, flowInstruction: e.target.value })}
              rows={8}
            />
          )}
        </FormField>
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          loading={applying}
          disabled={form.name.trim().length === 0}
          onClick={() => void handleCreate()}
        >
          {t("createAction")}
        </Button>
      </div>
    </div>
  );
}
