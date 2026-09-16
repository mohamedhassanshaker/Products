"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { validatePipelineConditionAction } from "../actions.js";

export interface PipelineConditionFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  knownNodeKeys: readonly string[];
  helpText?: string;
}

/**
 * The loop-back edge's own condition expression — validated on blur against `apps/ai`'s
 * real `domain/condition_expr.py` grammar (`POST /v1/orchestration/pipelines/
 * validate-condition`), the same grammar the interpreter itself will parse at run time, so
 * a condition this field accepts can never be one `ExecutePipeline` later refuses.
 */
export function PipelineConditionField({
  label,
  value,
  onChange,
  knownNodeKeys,
  helpText = "e.g. groundingConfidence < 0.6",
}: PipelineConditionFieldProps): React.ReactElement {
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [checking, setChecking] = React.useState(false);

  async function handleBlur() {
    if (value.trim() === "") {
      setError(undefined);
      return;
    }
    setChecking(true);
    const result = await validatePipelineConditionAction(value.trim(), knownNodeKeys);
    setChecking(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(result.value.valid ? undefined : result.value.issues.join(" "));
  }

  return (
    <FormField label={label} help={checking ? "Checking…" : helpText} error={error}>
      {(controlProps) => (
        <Input
          {...controlProps}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={handleBlur}
          placeholder={helpText}
        />
      )}
    </FormField>
  );
}
