"use client";

/** B3 steps 1-3 — Identity, Instructions, Model. All three are simple scalar-field forms against `AgentDetail`/`AgentVersionDetail`, so they share one file rather than three near-empty ones. */

import * as React from "react";
import { useTranslations } from "next-intl";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleRow } from "@/components/ui/toggle-row";
import { TONES, type Tone } from "../../../../../../../modules/agents/domain/agent.js";

export interface IdentityStepProps {
  readonly name: string;
  readonly description: string;
  readonly ownerTenantId: string;
  readonly onChange: (patch: { name?: string; description?: string }) => void;
}

export function IdentityStep({
  name,
  description,
  ownerTenantId,
  onChange,
}: IdentityStepProps): React.ReactElement {
  const t = useTranslations("agents.wizard.identity");
  return (
    // `max-w-lg` was a dead class: this bridge's `--container-*` reset is never
    // re-mapped (tailwind-theme.ts, ADR-0007 "replace, not extend"), so no `max-w-*`
    // utility compiles — the same confirmed-empty gap already fixed at
    // `sign-in-form.tsx`. Reproduced as the literal `rem` value `max-w-lg` would have
    // used (32rem), unaffected by the token gate's `px|pt|em`-only length pattern.
    <div className="flex flex-col gap-4" style={{ maxWidth: "32rem" }}>
      <FormField label={t("nameLabel")}>
        {(field) => (
          <Input
            {...field}
            value={name}
            onChange={(e) => onChange({ name: e.target.value })}
            required
          />
        )}
      </FormField>
      <FormField label={t("ownerLabel")} help={t("ownerHelp")}>
        {(field) => <Input {...field} value={ownerTenantId} disabled variant="mono" />}
      </FormField>
      <FormField label={t("descriptionLabel")}>
        {(field) => (
          <Textarea
            {...field}
            value={description}
            onChange={(e) => onChange({ description: e.target.value })}
            rows={3}
          />
        )}
      </FormField>
    </div>
  );
}

export interface InstructionsStepProps {
  readonly systemPrompt: string;
  readonly tone: Tone;
  readonly onChange: (patch: { systemPrompt?: string; tone?: Tone }) => void;
}

export function InstructionsStep({
  systemPrompt,
  tone,
  onChange,
}: InstructionsStepProps): React.ReactElement {
  const t = useTranslations("agents.wizard.instructions");
  return (
    // `max-w-2xl` was a dead class: this bridge's `--container-*` reset is never
    // re-mapped (tailwind-theme.ts, ADR-0007 "replace, not extend"), so no `max-w-*`
    // utility compiles — the same confirmed-empty gap already fixed at
    // `sign-in-form.tsx`. Reproduced as the literal `rem` value `max-w-2xl` would
    // have used (42rem), unaffected by the token gate's `px|pt|em`-only length
    // pattern.
    <div className="flex flex-col gap-4" style={{ maxWidth: "42rem" }}>
      <FormField label={t("systemPromptLabel")}>
        {(field) => (
          <Textarea
            {...field}
            value={systemPrompt}
            onChange={(e) => onChange({ systemPrompt: e.target.value })}
            rows={8}
          />
        )}
      </FormField>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">{t("toneLabel")}</span>
        <ToggleRow
          value={tone}
          onValueChange={(value) => onChange({ tone: value as Tone })}
          options={TONES.map((value) => ({ value, label: t(`tone.${value}`) }))}
          aria-label={t("toneLabel")}
        />
      </div>
    </div>
  );
}

export interface ModelStepProps {
  readonly primaryModel: string;
  readonly fallbackModel: string;
  readonly temperature: number;
  readonly onChange: (patch: {
    primaryModel?: string;
    fallbackModel?: string;
    temperature?: number;
  }) => void;
}

export function ModelStep({
  primaryModel,
  fallbackModel,
  temperature,
  onChange,
}: ModelStepProps): React.ReactElement {
  const t = useTranslations("agents.wizard.model");
  return (
    // `max-w-lg` was a dead class: this bridge's `--container-*` reset is never
    // re-mapped (tailwind-theme.ts, ADR-0007 "replace, not extend"), so no `max-w-*`
    // utility compiles — the same confirmed-empty gap already fixed at
    // `sign-in-form.tsx`. Reproduced as the literal `rem` value `max-w-lg` would have
    // used (32rem), unaffected by the token gate's `px|pt|em`-only length pattern.
    <div className="flex flex-col gap-4" style={{ maxWidth: "32rem" }}>
      <FormField label={t("primaryModelLabel")}>
        {(field) => (
          <Input
            {...field}
            value={primaryModel}
            onChange={(e) => onChange({ primaryModel: e.target.value })}
            variant="mono"
            required
          />
        )}
      </FormField>
      <FormField label={t("fallbackModelLabel")} help={t("fallbackModelHelp")}>
        {(field) => (
          <Input
            {...field}
            value={fallbackModel}
            onChange={(e) => onChange({ fallbackModel: e.target.value })}
            variant="mono"
          />
        )}
      </FormField>
      <FormField label={t("temperatureLabel")} help={t("temperatureHelp")}>
        {(field) => (
          <Input
            {...field}
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={temperature}
            onChange={(e) => onChange({ temperature: Number(e.target.value) })}
            variant="mono"
          />
        )}
      </FormField>
    </div>
  );
}
