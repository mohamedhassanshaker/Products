"use client";

/**
 * B3 step 5 — Knowledge. Review-comments-3: this step used to render a permanent stub
 * ("Knowledge collections aren't available yet ... binding opens once Knowledge (B-4)
 * ships") even though B6/B-4 had already shipped real `KnowledgeCollection`/`KnowledgeSource`
 * data and a real, tested `AgentKnowledgeBindings` read/write path
 * (`modules/agents/application/replace-knowledge-bindings.ts`) — only this step's own UI, and
 * the two Server Actions below, were ever missing.
 *
 * B6 ships no multi-collection picker (`KnowledgeSourceRepository.ensureDefaultCollection`'s
 * own doc comment: one lazily-created collection per tenant in practice) — so "binding" here
 * is a single enable/disable toggle for the tenant's one real collection, not a selection
 * among many. `loadKnowledgeStepData` resolves that collection lazily on mount, mirroring
 * `FlowsStep`'s identical "this step resolves its own backing resource lazily" shape rather
 * than `ToolsStep`'s SSR-prefetched-props style.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Switch } from "@/components/ui/switch";
import type { KnowledgeCollectionRow } from "../../../../../../../modules/knowledge/ports/knowledge-source-repository.js";
import type {
  loadKnowledgeStepDataAction,
  replaceKnowledgeBindingsAction,
} from "../../../actions.js";

export interface KnowledgeStepProps {
  readonly agentVersionId: string;
  readonly loadKnowledgeStepData: typeof loadKnowledgeStepDataAction;
  readonly replaceKnowledgeBindings: typeof replaceKnowledgeBindingsAction;
  /** True once this agent version has knowledge actually bound-and-enabled, per the wizard's own "is this step touched" convention (`FlowsStep`'s identical `onNodesChange`). */
  readonly onBindingsChange: (hasAny: boolean) => void;
}

export function KnowledgeStep({
  agentVersionId,
  loadKnowledgeStepData,
  replaceKnowledgeBindings,
  onBindingsChange,
}: KnowledgeStepProps): React.ReactElement {
  const t = useTranslations("agents.wizard.knowledge");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [collection, setCollection] = React.useState<KnowledgeCollectionRow | null>(null);
  const [enabled, setEnabled] = React.useState(false);
  /** The last real, saved state — what `onBindingsChange` reports. Deliberately not the same as `enabled`, which tracks the in-progress toggle before Save commits it. */
  const [committedEnabled, setCommittedEnabled] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = await loadKnowledgeStepData({ agentVersionId });
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const isEnabled = result.value.bindings.some(
        (b) => b.knowledgeCollectionId === result.value.collection.id && b.isEnabled,
      );
      setCollection(result.value.collection);
      setEnabled(isEnabled);
      setCommittedEnabled(isEnabled);
    })();
    return () => {
      cancelled = true;
    };
    // Runs once on mount, matching `FlowsStep`'s identical single-load pattern.
  }, []);

  React.useEffect(() => {
    onBindingsChange(committedEnabled);
  }, [committedEnabled]);

  async function handleSave(): Promise<void> {
    if (!collection) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const result = await replaceKnowledgeBindings({
      agentVersionId,
      bindings: [{ knowledgeCollectionId: collection.id, isEnabled: enabled }],
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCommittedEnabled(enabled);
    setSaved(true);
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
      {saved ? <InlineAlert variant="success">{t("savedNotice")}</InlineAlert> : null}
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <div
        className="flex items-center justify-between gap-4 border border-border bg-card"
        style={{ borderRadius: "var(--radius-md)", padding: "var(--space-3)" }}
      >
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">
            {collection?.name ?? t("collectionFallbackName")}
          </span>
          <span className="text-xs text-muted-foreground">{t("collectionDescription")}</span>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t("enableToggleLabel")} />
      </div>

      <div>
        <Button type="button" size="sm" loading={saving} onClick={() => void handleSave()}>
          {t("saveAction")}
        </Button>
      </div>
    </div>
  );
}
