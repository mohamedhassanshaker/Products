"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { FLOW_NODE_TYPE_META, type FlowNode, type FlowNodeType } from "./flow-canvas-types";

export interface MessageFormValue {
  type: "message";
  text: string;
}
export interface QuestionFormValue {
  type: "question";
  prompt: string;
  variableName: string;
}
export interface ToolCallFormValue {
  type: "tool-call";
  toolName: string;
  argumentsJson: string;
}
export interface HandoverFormValue {
  type: "handover";
  reason: string;
  queue: string;
}
export interface ConditionFormValue {
  type: "condition";
  expression: string;
  trueBranchLabel: string;
  falseBranchLabel: string;
}

/**
 * The five node-type-specific form shapes (design-system.md §5.5 #46:
 * *"`NodeInspector` panel… per node type, five distinct forms"*). A
 * discriminated union keyed on the same `FlowNodeType` the canvas and outline
 * view use, so a form can never be paired with the wrong node type at the
 * type level.
 */
export type NodeInspectorFormValue =
  MessageFormValue | QuestionFormValue | ToolCallFormValue | HandoverFormValue | ConditionFormValue;

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Real per-type validation, factored out as a pure function so it is
 * testable without rendering (`node-inspector.test.tsx` exercises every
 * branch directly). Returns an empty object when the value is valid — the
 * shape `FormField`'s own `error` prop expects per-field, not a single
 * pass/fail boolean, so a caller can point at exactly which field is wrong.
 */
export function validateNodeInspectorValue(value: NodeInspectorFormValue): Record<string, string> {
  const errors: Record<string, string> = {};

  switch (value.type) {
    case "message": {
      if (value.text.trim() === "") errors.text = "Message text is required.";
      break;
    }
    case "question": {
      if (value.prompt.trim() === "") errors.prompt = "The question prompt is required.";
      if (value.variableName.trim() === "") {
        errors.variableName = "A variable name is required.";
      } else if (!IDENTIFIER_PATTERN.test(value.variableName.trim())) {
        errors.variableName = "Use letters, numbers and underscores, starting with a letter.";
      }
      break;
    }
    case "tool-call": {
      if (value.toolName.trim() === "") errors.toolName = "A tool name is required.";
      if (value.argumentsJson.trim() !== "") {
        try {
          JSON.parse(value.argumentsJson);
        } catch {
          errors.argumentsJson = "Arguments must be valid JSON.";
        }
      }
      break;
    }
    case "handover": {
      if (value.reason.trim() === "") errors.reason = "A handover reason is required.";
      if (value.queue.trim() === "") errors.queue = "A destination queue is required.";
      break;
    }
    case "condition": {
      if (value.expression.trim() === "") errors.expression = "A condition expression is required.";
      if (value.trueBranchLabel.trim() === "") errors.trueBranchLabel = "Label this branch.";
      if (value.falseBranchLabel.trim() === "") errors.falseBranchLabel = "Label this branch.";
      break;
    }
    default: {
      // Exhaustiveness guard — `noFallthroughCasesInSwitch`/the discriminated
      // union above make this branch genuinely unreachable at the type
      // level; asserting it keeps a sixth node type from silently validating
      // as "always valid" if the union above is ever extended without also
      // extending this function.
      const exhaustive: never = value;
      throw new Error(`Unhandled node inspector form type: ${JSON.stringify(exhaustive)}`);
    }
  }

  return errors;
}

/** Builds a fresh, empty draft for a node type — `FlowCanvas` calls this when a node is selected with no prior draft value. */
export function emptyNodeInspectorValue(type: FlowNodeType): NodeInspectorFormValue {
  switch (type) {
    case "message":
      return { type: "message", text: "" };
    case "question":
      return { type: "question", prompt: "", variableName: "" };
    case "tool-call":
      return { type: "tool-call", toolName: "", argumentsJson: "" };
    case "handover":
      return { type: "handover", reason: "", queue: "" };
    case "condition":
      return { type: "condition", expression: "", trueBranchLabel: "Yes", falseBranchLabel: "No" };
  }
}

export interface NodeInspectorProps {
  node: FlowNode;
  value: NodeInspectorFormValue;
  onChange: (value: NodeInspectorFormValue) => void;
  onSave: () => void;
  onClose: () => void;
  dirty?: boolean;
  saving?: boolean;
  headingRef?: React.Ref<HTMLHeadingElement>;
  panelLabel?: string;
  closeLabel?: string;
  saveLabel?: string;
  savingLabel?: string;
  className?: string;
}

function MessageForm({
  value,
  errors,
  onChange,
}: {
  value: MessageFormValue;
  errors: Record<string, string>;
  onChange: (value: MessageFormValue) => void;
}) {
  return (
    <FormField label="Message text" {...(errors.text !== undefined ? { error: errors.text } : {})}>
      {(field) => (
        <Textarea
          {...field}
          value={value.text}
          onChange={(event) => onChange({ ...value, text: event.target.value })}
          rows={5}
        />
      )}
    </FormField>
  );
}

function QuestionForm({
  value,
  errors,
  onChange,
}: {
  value: QuestionFormValue;
  errors: Record<string, string>;
  onChange: (value: QuestionFormValue) => void;
}) {
  return (
    <div className="flex flex-col" style={{ gap: "var(--space-4)" }}>
      <FormField
        label="Question prompt"
        {...(errors.prompt !== undefined ? { error: errors.prompt } : {})}
      >
        {(field) => (
          <Textarea
            {...field}
            value={value.prompt}
            onChange={(event) => onChange({ ...value, prompt: event.target.value })}
            rows={3}
          />
        )}
      </FormField>
      <FormField
        label="Save answer as"
        help="The variable name later steps use to reference this answer."
        {...(errors.variableName !== undefined ? { error: errors.variableName } : {})}
      >
        {(field) => (
          <Input
            {...field}
            variant="mono"
            value={value.variableName}
            onChange={(event) => onChange({ ...value, variableName: event.target.value })}
          />
        )}
      </FormField>
    </div>
  );
}

function ToolCallForm({
  value,
  errors,
  onChange,
}: {
  value: ToolCallFormValue;
  errors: Record<string, string>;
  onChange: (value: ToolCallFormValue) => void;
}) {
  return (
    <div className="flex flex-col" style={{ gap: "var(--space-4)" }}>
      <FormField
        label="Tool"
        {...(errors.toolName !== undefined ? { error: errors.toolName } : {})}
      >
        {(field) => (
          <Input
            {...field}
            variant="mono"
            value={value.toolName}
            onChange={(event) => onChange({ ...value, toolName: event.target.value })}
          />
        )}
      </FormField>
      <FormField
        label="Arguments (JSON)"
        {...(errors.argumentsJson !== undefined ? { error: errors.argumentsJson } : {})}
      >
        {(field) => (
          // `Textarea` documents itself as *always* `dir="auto"` (deliberate,
          // for user-authored prose) — this field's content is code-shaped
          // (JSON), but overriding that atom's own stated invariant from here
          // is a bigger claim than this component should make unilaterally,
          // so this stays `auto` and only gains `font-mono` for legibility.
          <Textarea
            {...field}
            className="font-mono"
            value={value.argumentsJson}
            onChange={(event) => onChange({ ...value, argumentsJson: event.target.value })}
            rows={5}
          />
        )}
      </FormField>
    </div>
  );
}

function HandoverForm({
  value,
  errors,
  onChange,
}: {
  value: HandoverFormValue;
  errors: Record<string, string>;
  onChange: (value: HandoverFormValue) => void;
}) {
  return (
    <div className="flex flex-col" style={{ gap: "var(--space-4)" }}>
      <FormField
        label="Handover reason"
        {...(errors.reason !== undefined ? { error: errors.reason } : {})}
      >
        {(field) => (
          <Textarea
            {...field}
            value={value.reason}
            onChange={(event) => onChange({ ...value, reason: event.target.value })}
            rows={3}
          />
        )}
      </FormField>
      <FormField
        label="Destination queue"
        {...(errors.queue !== undefined ? { error: errors.queue } : {})}
      >
        {(field) => (
          <Input
            {...field}
            value={value.queue}
            onChange={(event) => onChange({ ...value, queue: event.target.value })}
          />
        )}
      </FormField>
    </div>
  );
}

function ConditionForm({
  value,
  errors,
  onChange,
}: {
  value: ConditionFormValue;
  errors: Record<string, string>;
  onChange: (value: ConditionFormValue) => void;
}) {
  return (
    <div className="flex flex-col" style={{ gap: "var(--space-4)" }}>
      <FormField
        label="Condition expression"
        {...(errors.expression !== undefined ? { error: errors.expression } : {})}
      >
        {(field) => (
          <Input
            {...field}
            variant="mono"
            value={value.expression}
            onChange={(event) => onChange({ ...value, expression: event.target.value })}
          />
        )}
      </FormField>
      <div className="grid grid-cols-2" style={{ gap: "var(--space-3)" }}>
        <FormField
          label="If true, branch to"
          {...(errors.trueBranchLabel !== undefined ? { error: errors.trueBranchLabel } : {})}
        >
          {(field) => (
            <Input
              {...field}
              value={value.trueBranchLabel}
              onChange={(event) => onChange({ ...value, trueBranchLabel: event.target.value })}
            />
          )}
        </FormField>
        <FormField
          label="If false, branch to"
          {...(errors.falseBranchLabel !== undefined ? { error: errors.falseBranchLabel } : {})}
        >
          {(field) => (
            <Input
              {...field}
              value={value.falseBranchLabel}
              onChange={(event) => onChange({ ...value, falseBranchLabel: event.target.value })}
            />
          )}
        </FormField>
      </div>
    </div>
  );
}

/**
 * B7's flow-designer inspector (design-system.md §5.5 #46). Five distinct
 * forms, one per `FlowNodeType`, all sharing one shell (type badge, title,
 * close, Save/dirty/saving footer). Real, working local validation — no tool
 * registry or flow-persistence API exists yet, so `onSave` is a plain
 * callback a later wave wires to a real mutation, but the form *shapes*,
 * required-field rules and JSON validation are genuinely functional now, not
 * stubs.
 *
 * **Fully controlled** (`value`/`onChange`), deliberately: `FlowCanvas` owns
 * the draft so the ≤820px inline-panel↔bottom-sheet presentation swap can
 * never lose in-progress edits, the same reasoning `AssistantWidgetShell`'s
 * no-remount requirement is built on, applied here by construction rather
 * than by a remount-proof test (this organism's own responsive swap is not
 * under the same explicit no-remount mandate, but controlling the data either
 * way costs nothing and removes the question entirely).
 */
export const NodeInspector = React.forwardRef<HTMLDivElement, NodeInspectorProps>(
  function NodeInspector(
    {
      node,
      value,
      onChange,
      onSave,
      onClose,
      dirty = false,
      saving = false,
      headingRef,
      panelLabel = "Node inspector",
      closeLabel = "Close inspector",
      saveLabel = "Save",
      savingLabel = "Saving…",
      className,
    },
    ref,
  ) {
    const meta = FLOW_NODE_TYPE_META[node.type];
    const errors = validateNodeInspectorValue(value);
    const isValid = Object.keys(errors).length === 0;

    // Escape-key event *delegation* from whichever field or button inside this
    // panel currently holds focus, not fake interactivity on the region itself
    // — identical reasoning and precedent to graph-canvas.tsx's `DetailPanel`,
    // which is where this pattern was first justified in this wave.
    return (
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <div
        ref={ref}
        data-slot="node-inspector"
        data-node-type={node.type}
        data-dirty={dirty ? "true" : undefined}
        role="region"
        aria-label={panelLabel}
        className={cn("flex h-full flex-col border border-border bg-card", className)}
        style={{ borderRadius: "var(--radius-lg)", padding: "var(--space-4)" }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div className="flex items-start justify-between">
          <div>
            <p
              className="flex items-center text-2xs font-medium tracking-wide uppercase"
              style={{ color: meta.colorToken, gap: "var(--space-1)" }}
            >
              <Icon icon={meta.glyph} size={14} />
              <span>{meta.badgeLabel}</span>
            </p>
            <h2
              ref={headingRef}
              tabIndex={-1}
              dir="auto"
              className="text-md font-semibold text-foreground outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]"
            >
              {node.title}
            </h2>
          </div>
          <IconButton ariaLabel={closeLabel} variant="ghost" size="sm" onClick={onClose}>
            <Icon icon={X} size={14} />
          </IconButton>
        </div>

        <div className="mt-4 flex-1 overflow-y-auto">
          {value.type === "message" ? (
            <MessageForm value={value} errors={errors} onChange={onChange} />
          ) : value.type === "question" ? (
            <QuestionForm value={value} errors={errors} onChange={onChange} />
          ) : value.type === "tool-call" ? (
            <ToolCallForm value={value} errors={errors} onChange={onChange} />
          ) : value.type === "handover" ? (
            <HandoverForm value={value} errors={errors} onChange={onChange} />
          ) : (
            <ConditionForm value={value} errors={errors} onChange={onChange} />
          )}
        </div>

        <div
          className="mt-4 flex items-center justify-end border-t border-border pt-3"
          style={{ gap: "var(--space-2)" }}
        >
          <Button
            variant="primary"
            size="sm"
            disabled={!isValid || saving}
            loading={saving}
            onClick={onSave}
          >
            {saving ? savingLabel : saveLabel}
          </Button>
        </div>
      </div>
    );
  },
);
