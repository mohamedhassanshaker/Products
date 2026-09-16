"use client";

import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  ChevronLeft,
  ChevronRight,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useResolvedDir } from "@/components/ui/use-resolved-dir";
import { useIsBelowBreakpoint } from "@/components/ui/use-media-query";
import { useWizardDraft } from "./use-wizard-draft";

export type WizardStepStatus = "untouched" | "in-progress" | "complete" | "invalid" | "blocked";

export interface WizardStep {
  id: string;
  /** Short chip label, e.g. "Skills & tools". */
  label: string;
  status: WizardStepStatus;
}

export interface WizardRenderStepArgs {
  /** The caller's own step content (its React Hook Form instance) calls this on every field change to (re)start the 5s autosave debounce — see `use-wizard-draft.ts`. */
  notifyDirty: () => void;
  /** True until `loadDraft` resolves. The caller should avoid mounting a form with default values while this is true — `Wizard` shows a loading placeholder instead of calling `renderStep` at all in that window, so this mainly matters if a caller wants to react to it directly. */
  restoring: boolean;
}

export interface WizardProps {
  /** In practice 10, per B-3 (design-system.md §5.5 #42) — kept a plain array rather than a fixed-length tuple type so this organism stays honestly reusable rather than silently coupled to one screen's step count. */
  steps: readonly WizardStep[];
  activeStepId: string;
  onStepChange: (stepId: string) => void;
  /** Render-prop for the step pane — the same "caller supplies a whole subtree, receives exactly the props it must wire up" contract `form-field.tsx` establishes, since a wizard step can be an arbitrary tree, not a single cloneable child. */
  renderStep: (step: WizardStep, index: number, args: WizardRenderStepArgs) => React.ReactNode;
  /** Notification only — `Wizard` already computes and navigates to the previous step itself (free navigation means Back is not privileged over any other step link). Optional, for a caller that wants to distinguish "pressed Back" from "clicked a step chip" in its own telemetry. */
  onBack?: () => void;
  /** The primary action on every step except the last. `Wizard` does not advance the step itself — cross-field validation is the caller's Zod schema (`architecture.md` §9), which this wave has no real instance of; the caller validates/saves and, on success, updates `activeStepId` itself. */
  onSaveAndContinue: () => void;
  /** The last step's primary action ("Publish agent"). Disabled by `Wizard` itself whenever the active (last) step's own `status` is `"blocked"` — see the component doc comment. */
  onPublish: () => void;
  onSaveDraft: (stepId: string) => void | Promise<void>;
  loadDraft?: () => void | Promise<void>;
  draftDebounceMs?: number;
  /**
   * Step ids whose own step-pane heading (the generic `<h2>{step.label}</h2>` every step
   * otherwise gets) should not render — review-comments-3: a step whose own content already
   * makes clear what it is (e.g. a canvas with its own status pill) doesn't need this
   * duplicated above it. §5.5 #42's "changing step moves focus to the step pane's heading"
   * contract still holds for a suppressed step: focus moves to the step-content wrapper
   * itself instead (`tabIndex={-1}`), never dropped.
   */
  hideHeadingForStepIds?: readonly string[];
  /** Accessible name for the step tablist. Default matches design-system.md §5.5 #42's own example verbatim; pass a translated string in real feature code. */
  ariaLabel?: string;
  backLabel?: string;
  saveAndContinueLabel?: string;
  publishLabel?: string;
  saveDraftLabel?: string;
  savingDraftLabel?: string;
  draftSavedLabel?: string;
  draftErrorLabel?: string;
  previousStepLabel?: string;
  nextStepLabel?: string;
  /** BCP-47 locale, threaded to `ProgressBar`'s own `Intl.NumberFormat` percent label — see that component's identical `locale` prop. */
  locale?: string;
  className?: string;
}

const DEFAULT_ARIA_LABEL = "Agent designer steps";
const DEFAULT_BACK_LABEL = "Back";
const DEFAULT_SAVE_AND_CONTINUE_LABEL = "Save & continue";
const DEFAULT_PUBLISH_LABEL = "Publish agent";
const DEFAULT_SAVE_DRAFT_LABEL = "Save draft";
const DEFAULT_SAVING_DRAFT_LABEL = "Saving draft…";
const DEFAULT_DRAFT_SAVED_LABEL = "Draft saved";
const DEFAULT_DRAFT_ERROR_LABEL = "Draft failed to save";
const DEFAULT_PREVIOUS_STEP_LABEL = "Previous step";
const DEFAULT_NEXT_STEP_LABEL = "Next step";
const RESTORING_DRAFT_LABEL = "Restoring draft";

/** See button.tsx for the full rationale. */
const FOCUS_VISIBLE_RING =
  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]";

/** Chip glyph per step status — always paired with the visible caption below (§6.1: status is never colour alone). */
const STATUS_ICON: Readonly<Record<WizardStepStatus, typeof Circle>> = {
  untouched: Circle,
  "in-progress": CircleDot,
  complete: CircleCheck,
  invalid: CircleAlert,
  blocked: Lock,
};

/**
 * The word each status contributes to a chip's composed accessible name and
 * its visible caption. Sourced from design-system.md §6.2's own status
 * vocabulary table where it names an exact word for "B3 wizard step state"
 * (`Untouched`, `In progress`, `Complete`), lower-cased to match the one
 * inline-sentence example §5.5 #42 gives verbatim ("Step 4 of 10: Skills &
 * tools — in progress"); `invalid` uses the exact phrase §5.5 #42's a11y
 * paragraph mandates ("the words 'Needs attention'"), not §6.2's vocabulary
 * (which has no "Invalid" row at all); `blocked` reuses §6.2's `Blocked`
 * row, which already names "B3 step 10" as one of its use sites.
 */
const STATUS_WORD: Readonly<Record<WizardStepStatus, string>> = {
  untouched: "untouched",
  "in-progress": "in progress",
  complete: "complete",
  invalid: "Needs attention",
  blocked: "blocked",
};

/** `"Step 4 of 10: Skills & tools — in progress"` — design-system.md §5.5 #42's own example, computed rather than hardcoded so it can never drift from the real step data (the brief's own "a real computed string, not a static label" bar, applied here the same way it is required for `PermissionMatrix`'s cell names). */
function composeStepAccessibleName(
  index: number,
  total: number,
  label: string,
  status: WizardStepStatus,
): string {
  return `Step ${index + 1} of ${total}: ${label} — ${STATUS_WORD[status]}`;
}

/** The ≤820px `Select`'s visible option/trigger text — "Step 4 of 10: Skills & tools" per §5.5 #42's own mobile-collapse example. */
function stepOptionLabel(index: number, total: number, step: WizardStep): string {
  return `Step ${index + 1} of ${total}: ${step.label}`;
}

/**
 * B3's 10-step authoring tool (design-system.md §5.5 #42), the brief's core
 * requirement (R7): *"A progress bar plus a 10-step tab strip. Any step is
 * directly clickable — the wizard does not force linear progress."*
 *
 * ## Why the step strip is hand-built on `TabsPrimitive`, not the `SubTabBar` molecule
 *
 * `SubTabBar` (design-system.md §5.4) is the obvious first reach — it is
 * already a working, RTL-correct, tested Radix-Tabs wrapper. It does not fit
 * here: its per-tab `label: React.ReactNode` slot has no way to give a tab a
 * distinct *accessible* name from its *visible* content, and this component's
 * spec mandates exactly that split — a chip visibly shows an index, a short
 * label and a glyph, but its accessible name is the fully composed sentence
 * `composeStepAccessibleName` builds above, in a different word order.
 * Forcing that through `SubTabBar` would mean either shipping the wrong
 * accessible name (its concatenated visible text content) or extending
 * `SubTabBar`'s own public API — a different, already-shipped, independently
 * verified molecule outside this wave's file scope. Built directly on
 * `TabsPrimitive` instead (the exact primitive `SubTabBar` itself wraps), so
 * an explicit `aria-label` can override the trigger's accessible name while
 * its visible children stay whatever this component needs — and reusing the
 * same `useResolvedDir()` fix `SubTabBar`/`ToggleRow`/`Slider` already
 * established for Radix's roving-focus arrow-key direction gap (§10.1).
 *
 * ## Why `activationMode="manual"`, unlike `SubTabBar`'s automatic activation
 *
 * design-system.md §10.4's keyboard-pattern table gives `Wizard` a materially
 * different row from `SubTabBar`'s: *"Arrow across steps, **Enter opens**"* —
 * arrow keys move the roving tab focus without switching the active step;
 * `Enter` (or a direct click, which Radix always treats as immediate
 * activation regardless of `activationMode` — that option only governs
 * keyboard-driven focus movement) is what actually commits the navigation.
 * `SubTabBar`'s own doc comment justifies automatic activation because its
 * panels are "cheap to render"; a wizard step is a meaningfully heavier,
 * more consequential thing to land on by just arrowing past it, which is
 * presumably exactly why the spec gives it a different model.
 *
 * ## The draft-save seam
 *
 * `useWizardDraft` (a dedicated, independently-tested hook — see that file)
 * owns the actual timing: a 5s trailing debounce the caller's step content
 * drives via `notifyDirty()`, and an immediate flush on every step change.
 * The flush has to happen *inside* the same synchronous handler that
 * initiates a step change, before `activeStepId` (a controlled prop) has
 * actually moved — `useWizardDraft`'s own "attribute the save to whichever
 * step is active right now" contract means firing it reactively from a
 * `useEffect` watching `activeStepId` would already be one render too late
 * (the hook's internal ref tracking the active step is kept current every
 * render, including the one that already carries the *new* id). All step
 * navigation in this file — chip clicks, the mobile `Select`, the mobile
 * prev/next arrows, and the footer's Back button — funnels through one
 * `goToStep` function for exactly this reason.
 */
export function Wizard({
  steps,
  activeStepId,
  onStepChange,
  renderStep,
  onBack,
  onSaveAndContinue,
  onPublish,
  onSaveDraft,
  loadDraft,
  draftDebounceMs,
  hideHeadingForStepIds,
  ariaLabel = DEFAULT_ARIA_LABEL,
  backLabel = DEFAULT_BACK_LABEL,
  saveAndContinueLabel = DEFAULT_SAVE_AND_CONTINUE_LABEL,
  publishLabel = DEFAULT_PUBLISH_LABEL,
  saveDraftLabel = DEFAULT_SAVE_DRAFT_LABEL,
  savingDraftLabel = DEFAULT_SAVING_DRAFT_LABEL,
  draftSavedLabel = DEFAULT_DRAFT_SAVED_LABEL,
  draftErrorLabel = DEFAULT_DRAFT_ERROR_LABEL,
  previousStepLabel = DEFAULT_PREVIOUS_STEP_LABEL,
  nextStepLabel = DEFAULT_NEXT_STEP_LABEL,
  locale,
  className,
}: WizardProps): React.ReactElement {
  const dir = useResolvedDir();
  const isCompact = useIsBelowBreakpoint(820);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const isFirstRenderRef = React.useRef(true);

  const draft = useWizardDraft({
    activeStepId,
    onSaveDraft,
    ...(loadDraft !== undefined ? { loadDraft } : {}),
    ...(draftDebounceMs !== undefined ? { debounceMs: draftDebounceMs } : {}),
  });

  const activeIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === activeStepId),
  );
  const activeStep = steps[activeIndex];
  const isLastStep = activeIndex === steps.length - 1;
  const completedCount = steps.filter((step) => step.status === "complete").length;
  const percent = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0;
  const percentFormatter = React.useMemo(
    () => new Intl.NumberFormat(locale, { style: "percent", numberingSystem: "latn" }),
    [locale],
  );
  const progressLabel = `Step ${activeIndex + 1} of ${steps.length} · ${percentFormatter.format(percent / 100)} complete`;

  const goToStep = React.useCallback(
    (stepId: string) => {
      if (stepId === activeStepId) return;
      // Fired synchronously, before `activeStepId` (a controlled prop) has
      // moved — see the component doc comment on why this ordering matters.
      void draft.flush();
      onStepChange(stepId);
    },
    [activeStepId, draft, onStepChange],
  );

  const handleBack = React.useCallback(() => {
    const previous = steps[activeIndex - 1];
    if (!previous) return;
    onBack?.();
    goToStep(previous.id);
  }, [activeIndex, goToStep, onBack, steps]);

  const handlePrimaryAction = React.useCallback(() => {
    void draft.flush();
    if (isLastStep) onPublish();
    else onSaveAndContinue();
  }, [draft, isLastStep, onPublish, onSaveAndContinue]);

  // `Ctrl+Enter` (design-system.md §5.5 #42's a11y note) submits whichever
  // primary action the active step currently shows. `metaKey` is included
  // defensively for a macOS keyboard even though this product's real fleet
  // is Windows-first (per env) — the guard costs nothing either way.
  const handlePaneKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      handlePrimaryAction();
    },
    [handlePrimaryAction],
  );

  // Moves focus to the step pane's heading whenever the active step changes
  // (§5.5 #42: "Changing step moves focus to the step pane's heading") — but
  // not on the very first render, which would steal focus from wherever the
  // surrounding page already placed it on initial load.
  React.useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    (headingRef.current ?? contentRef.current)?.focus();
  }, [activeStepId]);

  if (!activeStep) {
    return (
      <div data-slot="wizard" className={className}>
        <Skeleton variant="block" className="h-48 w-full" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div data-slot="wizard" className={className}>
      <ProgressBar
        variant="segmented"
        segments={{ total: steps.length, completed: completedCount }}
        label={progressLabel}
      />

      {/*
        A single `Tabs.Root` wraps both the step strip (or its mobile
        replacement) and the content pane below, rather than each owning a
        separate `Root` — the desktop strip's `Tabs.Trigger`s and the panel's
        `Tabs.Content` only get matching, Radix-generated `aria-controls`/
        `aria-labelledby` pairs when they share one root's internal id
        bookkeeping. An earlier draft of this file gave `DesktopStepStrip`
        its own nested `Root`, which silently broke that pairing (each
        `Root` mints ids no other `Root` knows about) — caught before
        landing, not shipped. In the compact view no `Tabs.Trigger` exists at
        all (`MobileStepPicker` is a plain `Select`, unrelated to Radix Tabs'
        context), so there is nothing to pair and nothing lost.
      */}
      <TabsPrimitive.Root
        value={activeStepId}
        onValueChange={goToStep}
        dir={dir}
        activationMode="manual"
      >
        <div
          className="mt-4"
          style={{ position: "sticky", insetBlockStart: 0, zIndex: "var(--z-sticky)" }}
        >
          {isCompact ? (
            <MobileStepPicker
              steps={steps}
              activeIndex={activeIndex}
              onSelect={goToStep}
              previousStepLabel={previousStepLabel}
              nextStepLabel={nextStepLabel}
              ariaLabel={ariaLabel}
            />
          ) : (
            <DesktopStepStrip steps={steps} activeStepId={activeStepId} ariaLabel={ariaLabel} />
          )}
        </div>

        <TabsPrimitive.Content value={activeStepId} className="mt-4" onKeyDown={handlePaneKeyDown}>
          {draft.restoring ? (
            <Skeleton variant="block" className="h-64 w-full" aria-label={RESTORING_DRAFT_LABEL} />
          ) : (
            <>
              {/* `tabIndex={-1}` makes this reachable only by the
                  programmatic `.focus()` call above, never by Tab — the
                  standard "move focus to the heading after a route/step
                  change" pattern. It keeps the ordinary `focus-visible` ring
                  recipe rather than suppressing it: browsers' own
                  `:focus-visible` heuristic still shows a ring for a
                  programmatically focused, non-natively-interactive element
                  like this one, and §10.3 is explicit that focus is never
                  removed without a replacement — there is no reason to
                  special-case this heading away from every other
                  focusable element's ring. */}
              {hideHeadingForStepIds?.includes(activeStep.id) ? null : (
                <h2
                  ref={headingRef}
                  tabIndex={-1}
                  className={cn("text-lg font-semibold text-foreground", FOCUS_VISIBLE_RING)}
                >
                  {activeStep.label}
                </h2>
              )}
              <div
                className={cn(
                  "mt-3",
                  hideHeadingForStepIds?.includes(activeStep.id) && FOCUS_VISIBLE_RING,
                )}
                {...(hideHeadingForStepIds?.includes(activeStep.id)
                  ? { ref: contentRef, tabIndex: -1 }
                  : {})}
              >
                {renderStep(activeStep, activeIndex, {
                  notifyDirty: draft.notifyDirty,
                  restoring: draft.restoring,
                })}
              </div>
            </>
          )}
        </TabsPrimitive.Content>
      </TabsPrimitive.Root>

      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        <Button type="button" variant="outline" disabled={activeIndex === 0} onClick={handleBack}>
          {backLabel}
        </Button>
        <div className="flex items-center" style={{ gap: "var(--space-3)" }}>
          <DraftStatus
            saving={draft.saving}
            error={draft.error}
            hasSavedOnce={draft.lastSavedAt !== null}
            savingDraftLabel={savingDraftLabel}
            draftSavedLabel={draftSavedLabel}
            draftErrorLabel={draftErrorLabel}
          />
          <Button type="button" variant="ghost" onClick={() => void draft.flush()}>
            {saveDraftLabel}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={isLastStep && activeStep.status === "blocked"}
            onClick={handlePrimaryAction}
          >
            {isLastStep ? publishLabel : saveAndContinueLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface DesktopStepStripProps {
  steps: readonly WizardStep[];
  activeStepId: string;
  ariaLabel: string;
}

/** Renders only `Tabs.List`/`Tabs.Trigger` — deliberately no `Tabs.Root` of its own; see the caller's doc comment on why it shares the outer one. */
function DesktopStepStrip({
  steps,
  activeStepId,
  ariaLabel,
}: DesktopStepStripProps): React.ReactElement {
  return (
    <TabsPrimitive.List
      aria-label={ariaLabel}
      className="flex items-center overflow-x-auto border-b border-border bg-background"
      style={{ gap: "var(--space-1)" }}
    >
      {steps.map((step, index) => {
        const StatusIcon = STATUS_ICON[step.status];
        const isActive = step.id === activeStepId;
        return (
          <TabsPrimitive.Trigger
            key={step.id}
            value={step.id}
            aria-label={composeStepAccessibleName(index, steps.length, step.label, step.status)}
            className={cn(
              "flex shrink-0 flex-col items-center whitespace-nowrap border-b-2 border-transparent text-xs font-medium text-muted-foreground",
              "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]",
              "data-[state=active]:border-primary data-[state=active]:text-foreground",
            )}
            style={{ paddingInline: "var(--space-3)", paddingBlock: "var(--space-2)" }}
          >
            <span
              aria-hidden="true"
              className="flex items-center"
              style={{ gap: "var(--space-1)" }}
            >
              <span
                className={cn("text-2xs", isActive ? "text-foreground" : "text-muted-foreground")}
              >
                {index + 1}
              </span>
              <Icon
                icon={StatusIcon}
                size={14}
                className={
                  step.status === "complete"
                    ? "text-success-strong"
                    : step.status === "invalid" || step.status === "blocked"
                      ? "text-destructive-strong"
                      : "text-muted-foreground"
                }
              />
              <span>{step.label}</span>
            </span>
            <span aria-hidden="true" className="text-2xs text-muted-foreground">
              {STATUS_WORD[step.status]}
            </span>
          </TabsPrimitive.Trigger>
        );
      })}
    </TabsPrimitive.List>
  );
}

interface MobileStepPickerProps {
  steps: readonly WizardStep[];
  activeIndex: number;
  onSelect: (stepId: string) => void;
  previousStepLabel: string;
  nextStepLabel: string;
  /** Fallback accessible name for the `Select` trigger for the degenerate empty-`steps` case only — every real render has a resolved `activeStep` and gets its own specific label instead (see the component body). */
  ariaLabel: string;
}

/** ≤820px collapse (design-system.md §5.5 #42): the step strip becomes a `Select` plus prev/next arrows; the progress bar (rendered by the caller, `Wizard`) remains untouched. */
function MobileStepPicker({
  steps,
  activeIndex,
  onSelect,
  previousStepLabel,
  nextStepLabel,
  ariaLabel,
}: MobileStepPickerProps): React.ReactElement {
  const activeStep = steps[activeIndex];

  return (
    <div className="flex items-center" style={{ gap: "var(--space-2)" }}>
      <IconButton
        variant="ghost"
        ariaLabel={previousStepLabel}
        disabled={activeIndex === 0}
        onClick={() => {
          const previous = steps[activeIndex - 1];
          if (previous) onSelect(previous.id);
        }}
      >
        <Icon icon={ChevronLeft} size={16} />
      </IconButton>
      {/* Conditional spread, not `value={activeStep?.id}` — see checkbox.tsx's
          identical note: `exactOptionalPropertyTypes` rejects an explicit
          `undefined` against Radix's own `value?: string`, which
          `activeStep?.id` still is for the degenerate empty-`steps` case. */}
      <Select
        {...(activeStep?.id !== undefined ? { value: activeStep.id } : {})}
        onValueChange={onSelect}
      >
        <SelectTrigger
          className="flex-1"
          // `role="combobox"` — which `SelectTrigger` renders — computes its
          // accessible name from `aria-label`/`aria-labelledby` only, never
          // from content text (unlike a plain `role="button"`, whose name
          // *does* fall back to its content): the ARIA spec's "Name From"
          // for the `combobox` role is "author" only. Confirmed the hard way
          // — a first draft relied purely on `SelectValue`'s visible text
          // and still failed this file's own `jest-axe` run
          // ("button-name"/"Buttons must have discernible text") even though
          // the text was genuinely present and correct in the rendered DOM,
          // proven with a throwaway render dump before concluding it was an
          // ARIA-role rule rather than a rendering bug. The explicit
          // `aria-label` below is therefore load-bearing, not redundant with
          // the visible `SelectValue` text next to it.
          aria-label={
            activeStep ? stepOptionLabel(activeIndex, steps.length, activeStep) : ariaLabel
          }
        >
          <SelectValue>
            {activeStep ? stepOptionLabel(activeIndex, steps.length, activeStep) : null}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {steps.map((step, index) => (
            <SelectItem key={step.id} value={step.id}>
              {stepOptionLabel(index, steps.length, step)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <IconButton
        variant="ghost"
        ariaLabel={nextStepLabel}
        disabled={activeIndex === steps.length - 1}
        onClick={() => {
          const next = steps[activeIndex + 1];
          if (next) onSelect(next.id);
        }}
      >
        <Icon icon={ChevronRight} size={16} />
      </IconButton>
    </div>
  );
}

interface DraftStatusProps {
  saving: boolean;
  error: Error | null;
  hasSavedOnce: boolean;
  savingDraftLabel: string;
  draftSavedLabel: string;
  draftErrorLabel: string;
}

/** `role="status"`/`aria-live="polite"` autosave indicator — the same live-region discipline `summary-strip.tsx`'s `consequence` variant uses for a computed statement about live state. */
function DraftStatus({
  saving,
  error,
  hasSavedOnce,
  savingDraftLabel,
  draftSavedLabel,
  draftErrorLabel,
}: DraftStatusProps): React.ReactElement | null {
  const text = saving
    ? savingDraftLabel
    : error
      ? draftErrorLabel
      : hasSavedOnce
        ? draftSavedLabel
        : null;
  if (text === null) return null;

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("text-xs", error ? "text-destructive-strong" : "text-muted-foreground")}
    >
      {text}
    </span>
  );
}
