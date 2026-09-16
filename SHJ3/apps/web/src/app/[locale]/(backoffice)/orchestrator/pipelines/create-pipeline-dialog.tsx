"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
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
import type { ActionResult } from "./actions.js";
import type { CreatePipelineResult } from "../../../../../modules/orchestration/application/create-pipeline.js";

export interface CreatePipelineDialogProps {
  locale: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  createPipeline: (input: { readonly name: string }) => Promise<ActionResult<CreatePipelineResult>>;
}

/** "New pipeline" — a single-field dialog, mirroring the simplicity of what
 *  `PipelineRepository.createPipeline` actually needs (a name; everything else — the
 *  Draft `v0.1` version, the lone `Start` node — the repository synthesizes atomically). */
export function CreatePipelineDialog({
  locale,
  open,
  onOpenChange,
  createPipeline,
}: CreatePipelineDialogProps): React.ReactElement {
  const t = useTranslations("orchestrator.pipeline");
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length === 0) {
      setError(t("nameRequiredError"));
      return;
    }
    setSubmitting(true);
    setError(undefined);
    const result = await createPipeline({ name: name.trim() });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.value.ok) {
      setError(result.value.reason);
      return;
    }
    onOpenChange(false);
    setName("");
    router.push(`/${locale}/orchestrator/pipelines/${result.value.pipelineDesignId}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t("createDialogHeading")}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <FormField label={t("nameLabel")} error={error}>
              {(controlProps) => (
                <Input
                  {...controlProps}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </FormField>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("cancelAction")}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "…" : t("createAction")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
