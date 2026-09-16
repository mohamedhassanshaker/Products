"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { CodeBlock } from "@/components/ui/code-block";
import { EmptyState } from "@/components/ui/empty-state";
import {
  groupTraceSteps,
  type DiffLine,
  type TraceStep,
  type TraceStepGroup,
  type TraceStepStatus,
} from "./diff-trace-viewer-types";

export type DiffTraceViewerState = "default" | "streaming" | "empty" | "error";

const STATUS_META: Readonly<
  Record<TraceStepStatus, { glyph: typeof CheckCircle2; colorToken: string; label: string }>
> = {
  success: { glyph: CheckCircle2, colorToken: "var(--success-strong)", label: "Succeeded" },
  warning: { glyph: AlertTriangle, colorToken: "var(--warning-strong)", label: "Warning" },
  error: { glyph: XCircle, colorToken: "var(--destructive-strong)", label: "Failed" },
  pending: { glyph: Clock, colorToken: "var(--muted-foreground)", label: "Pending" },
};

interface StepRowProps {
  step: TraceStep;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  showPayloadLabel: string;
  hidePayloadLabel: string;
  formatConfidence: (confidence: number) => string;
  formatDuration: (durationMs: number) => string;
}

function StepRow({
  step,
  isExpanded,
  onToggle,
  showPayloadLabel,
  hidePayloadLabel,
  formatConfidence,
  formatDuration,
}: StepRowProps) {
  const statusMeta = step.status ? STATUS_META[step.status] : undefined;
  const payloadId = `${step.id}-payload`;

  return (
    <li
      data-slot="diff-trace-viewer-step"
      data-status={step.status}
      className="border-s-2 bg-surface-sunken"
      style={{
        borderInlineStartColor: step.chartToken ?? statusMeta?.colorToken ?? "var(--border-strong)",
        borderRadius: "var(--radius-sm)",
        padding: "var(--space-2)",
      }}
    >
      <div
        className="flex flex-wrap items-center justify-between"
        style={{ gap: "var(--space-2)" }}
      >
        <div className="flex min-w-0 items-center" style={{ gap: "var(--space-2)" }}>
          {statusMeta ? (
            <Icon icon={statusMeta.glyph} size={14} style={{ color: statusMeta.colorToken }} />
          ) : null}
          <span
            dir="ltr"
            style={{ unicodeBidi: "isolate" }}
            className="truncate font-mono text-2xs text-foreground"
          >
            {step.primaryLine}
          </span>
        </div>
        <div
          className="flex shrink-0 items-center text-2xs text-muted-foreground"
          style={{ gap: "var(--space-2)" }}
        >
          {step.confidence !== undefined ? (
            <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
              {formatConfidence(step.confidence)}
            </span>
          ) : null}
          {step.durationMs !== undefined ? (
            <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
              {formatDuration(step.durationMs)}
            </span>
          ) : null}
          {statusMeta ? <span>{statusMeta.label}</span> : null}
          {step.payload !== undefined ? (
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-controls={payloadId}
              onClick={() => onToggle(step.id)}
              className={cn(
                "text-primary underline-offset-4 hover:underline",
                "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]",
              )}
            >
              {isExpanded ? hidePayloadLabel : showPayloadLabel}
            </button>
          ) : null}
        </div>
      </div>
      {step.payload !== undefined && isExpanded ? (
        <div id={payloadId} className="mt-2">
          <CodeBlock variant="json" code={step.payload} />
        </div>
      ) : null}
    </li>
  );
}

function StepGroupRow({
  group,
  expandedIds,
  onToggle,
  fanOutLabel,
  ...stepRowLabels
}: {
  group: TraceStepGroup;
  expandedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  fanOutLabel: string;
} & Pick<
  StepRowProps,
  "showPayloadLabel" | "hidePayloadLabel" | "formatConfidence" | "formatDuration"
>) {
  if (group.steps.length === 1) {
    const [only] = group.steps;
    if (!only) return null;
    return (
      <StepRow
        step={only}
        isExpanded={expandedIds.has(only.id)}
        onToggle={onToggle}
        {...stepRowLabels}
      />
    );
  }

  return (
    <li
      data-slot="diff-trace-viewer-group"
      className="border-s-2 border-border"
      style={{ padding: "var(--space-2)" }}
    >
      <p className="text-2xs font-medium text-muted-foreground">
        {fanOutLabel} ({group.steps.length})
      </p>
      <ol className="mt-1" style={{ display: "grid", gap: "var(--space-1)" }}>
        {group.steps.map((step) => (
          <StepRow
            key={step.id}
            step={step}
            isExpanded={expandedIds.has(step.id)}
            onToggle={onToggle}
            {...stepRowLabels}
          />
        ))}
      </ol>
    </li>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  const isAdded = line.kind === "added";
  const isRemoved = line.kind === "removed";
  const marker = isAdded ? "+" : isRemoved ? "−" : " ";
  const Wrapper = isAdded ? "ins" : isRemoved ? "del" : "span";

  return (
    <li
      data-slot="diff-trace-viewer-diff-line"
      className="flex font-mono text-2xs"
      style={{
        backgroundColor: isAdded
          ? "var(--success-subtle)"
          : isRemoved
            ? "var(--destructive-subtle)"
            : undefined,
        paddingInline: "var(--space-2)",
        paddingBlock: "var(--space-0)",
      }}
    >
      {/* The gutter marker is a second, non-colour channel alongside the fill
          (§5.5 #47: "never fill colour alone") — present even when the fill
          is absent (`unchanged` lines), so the marker column stays aligned. */}
      <span aria-hidden="true" className="w-4 shrink-0 text-muted-foreground select-none">
        {marker}
      </span>
      <Wrapper
        dir="ltr"
        style={{ unicodeBidi: "isolate" }}
        className="min-w-0 flex-1 whitespace-pre-wrap"
      >
        {line.text}
      </Wrapper>
    </li>
  );
}

function defaultFormatConfidence(confidence: number): string {
  return `confidence ${confidence.toFixed(2)}`;
}

function defaultFormatDuration(durationMs: number): string {
  return `${durationMs} ms`;
}

interface DiffTraceViewerSharedProps {
  state?: DiffTraceViewerState;
  errorMessage?: string;
  emptyHeadline?: string;
  emptyCause?: string;
  fanOutLabel?: string;
  showPayloadLabel?: string;
  hidePayloadLabel?: string;
  /** A function, not a plain string — matching summary-strip.tsx's `formatBlockedBy` precedent (§11.3 rule 4). Default renders exactly §5.5 #47's own example, `"confidence 0.94"`. */
  formatConfidence?: (confidence: number) => string;
  formatDuration?: (durationMs: number) => string;
  "aria-label"?: string;
  className?: string;
}

export interface DiffTraceViewerStepsProps extends DiffTraceViewerSharedProps {
  variant?: "trace" | "orchestration" | "grounding";
  steps: readonly TraceStep[];
}

export interface DiffTraceViewerDiffProps extends DiffTraceViewerSharedProps {
  variant: "diff";
  lines: readonly DiffLine[];
}

export type DiffTraceViewerProps = DiffTraceViewerStepsProps | DiffTraceViewerDiffProps;

/**
 * One component, three jobs (design-system.md §5.5 #47): A2's diagnostics
 * rail, B4's orchestration trace, B2's version diff — plus A2's Sources
 * (`grounding`) panel, all four sharing this one implementation rather than
 * four bespoke renderers.
 *
 * `<ol>` for every variant, deliberately — step/line order is structural,
 * not merely visual (§5.5 #47's own a11y note). Each expandable step is a
 * real `<button aria-expanded>`, payloads render through the real
 * `CodeBlock` rather than a second code-rendering implementation.
 */
export const DiffTraceViewer = React.forwardRef<HTMLDivElement, DiffTraceViewerProps>(
  function DiffTraceViewer(props, ref) {
    const {
      state = "default",
      errorMessage,
      emptyHeadline = "Nothing to show yet",
      emptyCause = "No grounding needed — static template.",
      fanOutLabel = "Ran in parallel",
      showPayloadLabel = "Show payload",
      hidePayloadLabel = "Hide payload",
      formatConfidence = defaultFormatConfidence,
      formatDuration = defaultFormatDuration,
      "aria-label": ariaLabel = "Trace",
      className,
    } = props;
    const stepRowLabels = { showPayloadLabel, hidePayloadLabel, formatConfidence, formatDuration };

    const [expandedIds, setExpandedIds] = React.useState<ReadonlySet<string>>(new Set());
    const toggleExpanded = React.useCallback((id: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }, []);

    // Streaming discipline (§5.5 #47's `streaming` state, §10.4): the live
    // region announces only the single *latest* step appended, never the
    // whole list re-read on every append — the opposite failure mode from
    // `ChatThread`'s own streaming rule (that component suppresses
    // announcement entirely until a turn finishes; this one announces every
    // append, just never more than the one new item).
    const previousStepCount = React.useRef(0);
    const [latestAnnouncement, setLatestAnnouncement] = React.useState("");
    const steps = props.variant === "diff" ? [] : props.steps;

    React.useEffect(() => {
      if (state !== "streaming") {
        previousStepCount.current = steps.length;
        return;
      }
      if (steps.length > previousStepCount.current) {
        const latest = steps[steps.length - 1];
        if (latest) setLatestAnnouncement(latest.primaryLine);
      }
      previousStepCount.current = steps.length;
    }, [state, steps]);

    if (state === "error") {
      return (
        <div
          ref={ref}
          data-slot="diff-trace-viewer"
          data-state="error"
          role="alert"
          className={cn("text-sm text-destructive-strong", className)}
        >
          {errorMessage ?? "The trace could not be loaded."}
        </div>
      );
    }

    if (
      state === "empty" ||
      (props.variant === "diff" ? props.lines.length === 0 : steps.length === 0)
    ) {
      return (
        <div ref={ref} data-slot="diff-trace-viewer" data-state="empty" className={className}>
          <EmptyState variant="first-run" headline={emptyHeadline} cause={emptyCause} />
        </div>
      );
    }

    const groups = props.variant === "diff" ? [] : groupTraceSteps(steps);

    return (
      <div
        ref={ref}
        data-slot="diff-trace-viewer"
        data-variant={props.variant ?? "trace"}
        data-state={state}
        aria-label={ariaLabel}
        className={cn("flex flex-col", className)}
        style={{ gap: "var(--space-1)" }}
      >
        {state === "streaming" ? (
          <span role="status" aria-live="polite" className="sr-only">
            {latestAnnouncement}
          </span>
        ) : null}
        <ol style={{ display: "grid", gap: "var(--space-1)" }}>
          {props.variant === "diff"
            ? props.lines.map((line) => <DiffLineRow key={line.id} line={line} />)
            : groups.map((group) => (
                <StepGroupRow
                  key={group.key}
                  group={group}
                  expandedIds={expandedIds}
                  onToggle={toggleExpanded}
                  fanOutLabel={fanOutLabel}
                  {...stepRowLabels}
                />
              ))}
        </ol>
      </div>
    );
  },
);
