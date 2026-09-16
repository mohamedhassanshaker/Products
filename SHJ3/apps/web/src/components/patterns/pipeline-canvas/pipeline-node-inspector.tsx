"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { PIPELINE_NODE_KIND_META, type PipelineCanvasNode } from "./pipeline-canvas-types";

/** One inspector field, described as DATA rather than hard-coded — the backend's real
 *  per-node config surface (`PipelineNode.*Override`, `agentId`, `onErrorPolicy`, …) is
 *  supplied by the route (which knows the tenant's real agent list, the closed vocabularies,
 *  etc.), so adding a field later is a data change here, not a component rewrite — this
 *  module's own design decision. */
export type PipelineNodeFieldSpec =
  | { readonly key: string; readonly kind: "text"; readonly label: string; readonly required?: boolean }
  | { readonly key: string; readonly kind: "textarea"; readonly label: string }
  | { readonly key: string; readonly kind: "number"; readonly label: string; readonly min?: number; readonly max?: number }
  | { readonly key: string; readonly kind: "boolean"; readonly label: string }
  | {
      readonly key: string;
      readonly kind: "select";
      readonly label: string;
      readonly options: readonly { readonly value: string; readonly label: string }[];
    };

export type PipelineNodeFormValue = Readonly<Record<string, string | number | boolean | null>>;

export interface PipelineNodeInspectorProps {
  node: PipelineCanvasNode;
  fields: readonly PipelineNodeFieldSpec[];
  value: PipelineNodeFormValue;
  errors?: Readonly<Record<string, string>>;
  onChange: (value: PipelineNodeFormValue) => void;
  onSave: () => void;
  onClose: () => void;
  onDelete?: (() => void) | undefined;
  dirty?: boolean;
  saving?: boolean;
  saveLabel?: string;
  deleteLabel?: string;
  closeLabel?: string;
  headingRef?: React.RefObject<HTMLHeadingElement | null>;
  className?: string;
}

/**
 * Per-node configuration panel — mirrors `flow-canvas/node-inspector.tsx`'s panel shell
 * (heading focus management, dirty/saving states, close-returns-focus contract) but is
 * descriptor-driven rather than a fixed five-branch `switch`, since a pipeline node's real
 * config surface (§1 of this feature's design) is a much larger, per-kind-varying set of
 * optional fields than a flow node's five fixed forms.
 */
export function PipelineNodeInspector({
  node,
  fields,
  value,
  errors = {},
  onChange,
  onSave,
  onClose,
  onDelete,
  dirty = false,
  saving = false,
  saveLabel = "Save",
  deleteLabel = "Delete node",
  closeLabel = "Close inspector",
  headingRef,
  className,
}: PipelineNodeInspectorProps): React.ReactElement {
  const meta = PIPELINE_NODE_KIND_META[node.kind];

  function setField(key: string, next: string | number | boolean | null) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div
      data-slot="pipeline-node-inspector"
      className={cn("flex flex-col border border-border bg-card", className)}
      style={{ borderRadius: "var(--radius-lg)", padding: "var(--space-3)", gap: "var(--space-3)" }}
    >
      <div className="flex items-start justify-between" style={{ gap: "var(--space-2)" }}>
        <div>
          <p className="text-2xs font-medium tracking-wide uppercase" style={{ color: meta.colorToken }}>
            {meta.badgeLabel}
          </p>
          <h3
            ref={headingRef}
            tabIndex={-1}
            dir="auto"
            className="text-sm font-semibold text-foreground outline-none"
          >
            {node.title}
          </h3>
        </div>
        <IconButton ariaLabel={closeLabel} variant="ghost" size="sm" onClick={onClose}>
          <Icon icon={X} size={16} />
        </IconButton>
      </div>

      <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
        {fields.map((field) => {
          const fieldValue = value[field.key];
          const error = errors[field.key];
          if (field.kind === "boolean") {
            return (
              <label
                key={field.key}
                className="flex items-center"
                style={{ gap: "var(--space-2)" }}
              >
                <Checkbox
                  checked={Boolean(fieldValue)}
                  onCheckedChange={(checked) => setField(field.key, checked === true)}
                  aria-label={field.label}
                />
                <span className="text-sm text-foreground">{field.label}</span>
              </label>
            );
          }
          return (
            <FormField key={field.key} label={field.label} error={error}>
              {(controlProps) =>
                field.kind === "text" ? (
                  <Input
                    {...controlProps}
                    value={typeof fieldValue === "string" ? fieldValue : ""}
                    onChange={(event) => setField(field.key, event.target.value)}
                  />
                ) : field.kind === "textarea" ? (
                  <Textarea
                    {...controlProps}
                    value={typeof fieldValue === "string" ? fieldValue : ""}
                    onChange={(event) => setField(field.key, event.target.value)}
                  />
                ) : field.kind === "number" ? (
                  <Input
                    {...controlProps}
                    type="number"
                    min={field.min}
                    max={field.max}
                    value={typeof fieldValue === "number" ? fieldValue : ""}
                    onChange={(event) =>
                      setField(field.key, event.target.value === "" ? null : Number(event.target.value))
                    }
                  />
                ) : (
                  <select
                    {...controlProps}
                    value={typeof fieldValue === "string" ? fieldValue : ""}
                    onChange={(event) => setField(field.key, event.target.value)}
                    className="h-9 w-full border border-border bg-background text-sm"
                    style={{ borderRadius: "var(--radius-md)", padding: "0 var(--space-2)" }}
                  >
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )
              }
            </FormField>
          );
        })}
      </div>

      <div className="flex items-center justify-between" style={{ gap: "var(--space-2)" }}>
        {onDelete ? (
          <Button type="button" variant="ghost" onClick={onDelete} className="text-destructive-strong">
            {deleteLabel}
          </Button>
        ) : (
          <span />
        )}
        <Button type="button" onClick={onSave} disabled={!dirty || saving}>
          {saving ? "Saving…" : saveLabel}
        </Button>
      </div>
    </div>
  );
}
