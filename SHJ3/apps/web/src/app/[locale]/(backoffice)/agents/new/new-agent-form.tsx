"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { createAgentAction } from "../actions.js";

export interface NewAgentFormProps {
  readonly createAgent: typeof createAgentAction;
}

/** B3 step 1's minimal standalone form — see `page.tsx`'s doc comment for why this route exists separately from the wizard shell. */
export function NewAgentForm({ createAgent }: NewAgentFormProps): React.ReactElement {
  const t = useTranslations("agents.new");
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    // `max-w-lg` was a dead class: this bridge's `--container-*` reset is never
    // re-mapped (tailwind-theme.ts, ADR-0007 "replace, not extend"), so no `max-w-*`
    // utility compiles — the same confirmed-empty gap already fixed at
    // `sign-in-form.tsx`. Reproduced as the literal `rem` value `max-w-lg` would have
    // used (32rem), unaffected by the token gate's `px|pt|em`-only length pattern.
    <form
      className="flex flex-col gap-4"
      style={{ maxWidth: "32rem" }}
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        void createAgent({
          name,
          description: description.trim().length > 0 ? description.trim() : null,
        })
          .then((result) => {
            if (result.ok) {
              router.push(`/${locale}/agents/${result.value.agentId}/edit`);
            } else {
              setError(result.error);
              setPending(false);
            }
          })
          .catch((caught: unknown) => {
            setError(caught instanceof Error ? caught.message : String(caught));
            setPending(false);
          });
      }}
    >
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
      <FormField label={t("nameLabel")}>
        {(field) => (
          <Input
            {...field}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        )}
      </FormField>
      <FormField label={t("descriptionLabel")} help={t("descriptionHint")}>
        {(field) => (
          <Textarea
            {...field}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
          />
        )}
      </FormField>
      <div className="flex justify-end">
        <Button type="submit" loading={pending} disabled={name.trim().length === 0}>
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
