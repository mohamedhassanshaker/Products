"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/patterns/dialog/dialog.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import type { PipelineEdgeRow } from "../../../../../../modules/orchestration/ports/pipeline-repository.js";
import { PipelineConditionField } from "./pipeline-condition-field.js";

export interface PipelineEdgeDialogValue {
  readonly kind: PipelineEdgeRow["kind"];
  readonly label: string;
  readonly maxIterations: number | null;
  readonly conditionExpression: string | null;
}

export interface PipelineEdgeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  edge: PipelineEdgeRow | undefined;
  knownNodeKeys: readonly string[];
  onSave: (value: PipelineEdgeDialogValue) => void;
  onDelete: () => void;
  saving?: boolean;
  error?: string | undefined;
}

/** Edits a wire's own fields — mandatory `maxIterations` and optional `conditionExpression`
 *  appear only once `kind === "LoopBack"`, the UI-level mirror of `CK_PipelineEdges_
 *  loopFields`/`_conditionOnlyOnLoop` (the server, via `createPipelineEdgeAction`/
 *  `updatePipelineEdgeAction`, is still the real, final check). */
export function PipelineEdgeDialog({
  open,
  onOpenChange,
  edge,
  knownNodeKeys,
  onSave,
  onDelete,
  saving = false,
  error,
}: PipelineEdgeDialogProps): React.ReactElement | null {
  const t = useTranslations("orchestrator.pipeline.edgeDialog");
  const [kind, setKind] = React.useState<PipelineEdgeRow["kind"]>("Sequential");
  const [label, setLabel] = React.useState("");
  const [maxIterations, setMaxIterations] = React.useState<number>(3);
  const [conditionExpression, setConditionExpression] = React.useState("");

  React.useEffect(() => {
    if (!edge) return;
    setKind(edge.kind);
    setLabel(edge.label ?? "");
    setMaxIterations(edge.maxIterations ?? 3);
    setConditionExpression(edge.conditionExpression ?? "");
  }, [edge]);

  if (!edge) return null;
  const isLoopBack = kind === "LoopBack";

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      kind,
      label,
      maxIterations: isLoopBack ? maxIterations : null,
      conditionExpression: isLoopBack && conditionExpression.trim() !== "" ? conditionExpression.trim() : null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t("heading")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col" style={{ gap: "var(--space-3)", padding: "var(--space-2) 0" }}>
            <FormField label={t("kindLabel")}>
              {(controlProps) => (
                <select
                  {...controlProps}
                  value={kind}
                  onChange={(event) => setKind(event.target.value as PipelineEdgeRow["kind"])}
                  className="h-9 w-full border border-border bg-background text-sm"
                  style={{ borderRadius: "var(--radius-md)", padding: "0 var(--space-2)" }}
                >
                  <option value="Sequential">{t("kindSequential")}</option>
                  <option value="Parallel">{t("kindParallel")}</option>
                  <option value="LoopBack">{t("kindLoopBack")}</option>
                </select>
              )}
            </FormField>
            <FormField label={t("labelLabel")}>
              {(controlProps) => (
                <Input {...controlProps} value={label} onChange={(e) => setLabel(e.target.value)} />
              )}
            </FormField>
            {isLoopBack ? (
              <>
                <FormField label={t("maxIterationsLabel")}>
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      type="number"
                      min={1}
                      max={20}
                      value={maxIterations}
                      onChange={(e) => setMaxIterations(Number(e.target.value))}
                    />
                  )}
                </FormField>
                <PipelineConditionField
                  label={t("conditionLabel")}
                  value={conditionExpression}
                  onChange={setConditionExpression}
                  knownNodeKeys={knownNodeKeys}
                />
              </>
            ) : null}
            {error ? <p className="text-xs text-destructive-strong">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" className="text-destructive-strong" onClick={onDelete}>
              {t("deleteAction")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t("saving") : t("saveAction")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
