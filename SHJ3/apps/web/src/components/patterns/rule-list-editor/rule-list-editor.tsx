"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Pencil, Play, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardFooter, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { DestructiveConfirmDialog } from "@/components/patterns/dialog";

function defaultReorderAnnouncementTemplate(
  ruleName: string,
  position: number,
  total: number,
): string {
  return `${ruleName} is now rule ${position} of ${total}`;
}

function defaultMoveUpLabel(ruleName: string): string {
  return `Move ${ruleName} up`;
}

function defaultMoveDownLabel(ruleName: string): string {
  return `Move ${ruleName} down`;
}

function defaultEnabledSwitchLabel(ruleName: string): string {
  return `${ruleName} enabled`;
}

function defaultDeleteDescriptionTemplate(ruleName: string): string {
  return `${ruleName} will be permanently removed from this list, and it cannot be undone.`;
}

/**
 * A real, sensible default rather than nothing — `emptyState` stays fully
 * overridable (a plain `React.ReactNode` prop, the same pattern
 * `search-field.tsx`'s `clearButtonLabel = "Clear search"` default
 * establishes for an English default with a full override path), so a real
 * screen supplies its own translated, product-specific copy (B8's "+ Add
 * rule" affordance, B12's policy-specific wording) while this component
 * still renders *something* real rather than a silent gap when unstyled.
 */
const DEFAULT_EMPTY_STATE = (
  <EmptyState headline="No rules yet" cause="Add a rule to start routing." />
);

/** Swap `rules[index]` with its neighbour in `direction`. Returns `null` at a boundary — the caller decides what "no-op" means (here: don't call `onReorder`, don't announce). */
function swapRule<TRule>(
  rules: readonly TRule[],
  index: number,
  direction: "up" | "down",
): { next: readonly TRule[]; newIndex: number } | null {
  const newIndex = direction === "up" ? index - 1 : index + 1;
  if (newIndex < 0 || newIndex >= rules.length) return null;
  const next = rules.slice();
  const [moved] = next.splice(index, 1);
  if (moved === undefined) return null;
  next.splice(newIndex, 0, moved);
  return { next, newIndex };
}

export interface RuleListEditorProps<TRule extends { id: string }, TTestInput> {
  /** Current precedence order — index 0 is the highest-priority rule ("top to bottom; first active match wins", design-system.md §5.5 #54). */
  rules: readonly TRule[];
  /** Fires with the full reordered array; this component never owns rule state itself. */
  onReorder: (rules: readonly TRule[]) => void;
  /**
   * Renders a rule's condition/route-target summary — rule *semantics*
   * belong entirely to the caller (§5.5 #54's brief: "this component owns
   * the list UI/reordering/testing UX, not rule semantics for any
   * particular product feature"). This component supplies the surrounding
   * `Card`, rank number and action row.
   */
  renderRule: (rule: TRule, context: { index: number; total: number }) => React.ReactNode;
  /** Short human name for a rule, used in every announcement and confirmation this component generates — e.g. "Rule 2: Priority = High". */
  getRuleName: (rule: TRule) => string;

  /** Omit entirely if this rule list has no enable/disable concept. */
  isEnabled?: (rule: TRule) => boolean;
  onToggleEnabled?: (rule: TRule) => void;
  enabledSwitchLabel?: (ruleName: string) => string;

  onEdit?: (rule: TRule) => void;
  /** Default is English; pass a translated string in real feature code. */
  editLabel?: string;

  onDelete?: (rule: TRule) => void;
  /** Also becomes the destructive dialog's real action verb — never a bare "OK" (§5.5 #53's own rule, composed here via the real `DestructiveConfirmDialog`). */
  deleteLabel?: string;
  deleteDialogTitle?: string;
  deleteDescriptionTemplate?: (ruleName: string) => React.ReactNode;

  moveUpLabel?: (ruleName: string) => string;
  moveDownLabel?: (ruleName: string) => string;
  /** Every reorder is announced through this template — §5.5 #54: "every reorder announces the new order." Default is English; pass a translated template in real feature code. */
  reorderAnnouncementTemplate?: (ruleName: string, position: number, total: number) => string;

  /** Accessible name for the ordered rule list itself, e.g. "Routing rules". */
  "aria-label": string;
  /** Rendered in place of the list when `rules` is empty. */
  emptyState?: React.ReactNode;

  // --- Tester — "evaluating the live, unsaved rule order" (§5.5 #54) ---
  /** Caller-supplied predicate — deliberately not a rule-matching DSL owned by this component. */
  matches: (rule: TRule, input: TTestInput) => boolean;
  testInput: TTestInput;
  onTestInputChange: (input: TTestInput) => void;
  /** Renders the caller's own test-input fields (B8: Topic/Priority/Channel/Wait time) — this component knows nothing about their shape. */
  renderTestForm: (props: {
    input: TTestInput;
    onChange: (input: TTestInput) => void;
  }) => React.ReactNode;
  /** Fires after every "Run test" click, so a caller can log/react to the outcome without re-deriving it. */
  onRunTest?: (result: { rule: TRule; index: number } | null) => void;
  /** How the fired rule is described in the result line. Defaults to `getRuleName`. */
  renderMatchedRuleSummary?: (rule: TRule) => React.ReactNode;
  runTestLabel?: string;
  /** Shown when no active rule matches. Default is a generic English sentence; a real screen (B8's "falls to the default queue") should override it — this component has no opinion on what happens after a miss. */
  noMatchMessage?: React.ReactNode;
  testerAriaLabel?: string;

  className?: string;
}

/**
 * B8's routing rules + rule tester, B12's policy list (design-system.md §5.5
 * #54). Order *is* meaning: precedence renders as an explicit rank plus a
 * real `<ol>` (matching `DiffTraceViewer`'s identical "order is structural,
 * not just visual" reasoning for its own step list), reorders are
 * button-driven **and** `Alt+ArrowUp`/`Alt+ArrowDown` (§10.4's table), and
 * every reorder is announced in a polite live region naming the rule's new
 * position — never silently.
 *
 * Delete composes the real `DestructiveConfirmDialog` (this same wave's
 * `components/patterns/dialog`) rather than a bespoke confirm — §5.5 #53's
 * "restate the object by name, never a bare OK" rule reaching a real
 * consumer, not just the one place it was defined.
 *
 * A plain generic function component, not `React.forwardRef` — combining
 * `forwardRef` with a component generic over both `TRule` and `TTestInput`
 * needs an explicit re-declared call signature to keep both type parameters
 * inferrable at every call site (`forwardRef`'s own type otherwise collapses
 * them), for a component with no clear caller need to reach a DOM node
 * through it in the first place. Every other organism in this wave forwards
 * a ref because each wraps one obvious root element a caller plausibly
 * measures or focuses; this one is a composite of an ordered list and a
 * separate tester region with no single such element.
 */
export function RuleListEditor<TRule extends { id: string }, TTestInput>({
  rules,
  onReorder,
  renderRule,
  getRuleName,
  isEnabled,
  onToggleEnabled,
  enabledSwitchLabel = defaultEnabledSwitchLabel,
  onEdit,
  editLabel = "Edit",
  onDelete,
  deleteLabel = "Delete",
  deleteDialogTitle = "Delete this rule?",
  deleteDescriptionTemplate = defaultDeleteDescriptionTemplate,
  moveUpLabel = defaultMoveUpLabel,
  moveDownLabel = defaultMoveDownLabel,
  reorderAnnouncementTemplate = defaultReorderAnnouncementTemplate,
  "aria-label": ariaLabel,
  emptyState = DEFAULT_EMPTY_STATE,
  matches,
  testInput,
  onTestInputChange,
  renderTestForm,
  onRunTest,
  renderMatchedRuleSummary,
  runTestLabel = "Run test",
  noMatchMessage = "No rule matched.",
  testerAriaLabel = "Rule tester",
  className,
}: RuleListEditorProps<TRule, TTestInput>): React.ReactElement {
  const [announcement, setAnnouncement] = React.useState("");
  const [pendingDelete, setPendingDelete] = React.useState<TRule | null>(null);
  const [lastResult, setLastResult] = React.useState<
    { rule: TRule; index: number } | null | undefined
  >(undefined);

  const move = React.useCallback(
    (index: number, direction: "up" | "down") => {
      const swapped = swapRule(rules, index, direction);
      if (!swapped) return;
      onReorder(swapped.next);
      const movedRule = swapped.next[swapped.newIndex];
      if (movedRule !== undefined) {
        setAnnouncement(
          reorderAnnouncementTemplate(getRuleName(movedRule), swapped.newIndex + 1, rules.length),
        );
      }
    },
    [rules, onReorder, reorderAnnouncementTemplate, getRuleName],
  );

  const handleRowKeyDown = (index: number) => (event: React.KeyboardEvent) => {
    if (!event.altKey) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      move(index, "up");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      move(index, "down");
    }
  };

  const handleRunTest = () => {
    const activeRules = isEnabled ? rules.filter((rule) => isEnabled(rule)) : rules;
    const matchedRule = activeRules.find((rule) => matches(rule, testInput));
    const result =
      matchedRule !== undefined ? { rule: matchedRule, index: rules.indexOf(matchedRule) } : null;
    setLastResult(result);
    onRunTest?.(result);
  };

  return (
    <div
      data-slot="rule-list-editor"
      className={cn("flex flex-col", className)}
      style={{ gap: "var(--space-6)" }}
    >
      <div>
        {
          // Reorders are announced here, and only here — a single live
          // region shared by every row, matching `search-field.tsx`'s /
          // `date-range-toggle.tsx`'s established "one polite status region
          // per component" shape rather than one per row. Deliberately
          // `sr-only` rather than those two components' *visible* status
          // text: their count is information a sighted user cannot
          // otherwise see, while a reorder's new position is already
          // plainly visible in the rank number that just changed — an
          // additional visible line would only restate it. Screen readers
          // still hear it: `aria-live` fires from content changes
          // regardless of visual visibility.
        }
        <span role="status" aria-live="polite" className="sr-only">
          {announcement}
        </span>

        {rules.length === 0 && emptyState ? (
          emptyState
        ) : (
          <ol
            aria-label={ariaLabel}
            className="flex list-none flex-col"
            style={{ gap: "var(--space-3)" }}
          >
            {rules.map((rule, index) => {
              const ruleName = getRuleName(rule);
              const enabled = isEnabled ? isEnabled(rule) : true;

              // `Alt+ArrowUp`/`Alt+ArrowDown` reorders "the focused rule"
              // (§10.4's table) — attached directly to every real,
              // already-focusable control in the row rather than to a
              // wrapping `<div>`/`<li>` catching bubbled events. Both
              // `jsx-a11y/no-noninteractive-element-interactions` (on `<li>`,
              // whose implicit role is `listitem`) and `jsx-a11y/no-static-
              // element-interactions` (on a plain `<div>`) correctly flagged
              // that shape: a keyboard handler on an element with no
              // interactive role is exactly the accessibility smell those
              // rules exist to catch, and a delegation convenience doesn't
              // change that a screen-reader/keyboard user has no way to know
              // the container itself does anything. Repeating the same
              // handler reference on each of a row's real buttons costs a
              // few characters per element and has no such gap.
              const rowKeyDown = handleRowKeyDown(index);

              return (
                <li key={rule.id} className="flex items-start" style={{ gap: "var(--space-3)" }}>
                  <span
                    aria-hidden="true"
                    className="flex shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground"
                    style={{
                      inlineSize: "var(--control-height-sm)",
                      blockSize: "var(--control-height-sm)",
                      marginBlockStart: "var(--space-1)",
                    }}
                  >
                    {index + 1}
                  </span>

                  <Card className={cn("flex-1", !enabled && "opacity-60")}>
                    <CardHeader>
                      <div className="min-w-0 flex-1">
                        {renderRule(rule, { index, total: rules.length })}
                      </div>
                      {onToggleEnabled ? (
                        <Switch
                          checked={enabled}
                          onCheckedChange={() => onToggleEnabled(rule)}
                          onKeyDown={rowKeyDown}
                          aria-label={enabledSwitchLabel(ruleName)}
                        />
                      ) : null}
                    </CardHeader>
                    <CardFooter>
                      <IconButton
                        ariaLabel={moveUpLabel(ruleName)}
                        variant="ghost"
                        size="sm"
                        disabled={index === 0}
                        onClick={() => move(index, "up")}
                        onKeyDown={rowKeyDown}
                      >
                        <Icon icon={ArrowUp} size={16} mirrorInRtl={false} />
                      </IconButton>
                      <IconButton
                        ariaLabel={moveDownLabel(ruleName)}
                        variant="ghost"
                        size="sm"
                        disabled={index === rules.length - 1}
                        onClick={() => move(index, "down")}
                        onKeyDown={rowKeyDown}
                      >
                        <Icon icon={ArrowDown} size={16} mirrorInRtl={false} />
                      </IconButton>
                      {onEdit ? (
                        <Button
                          variant="outline"
                          size="sm"
                          iconStart={<Icon icon={Pencil} size={14} />}
                          onClick={() => onEdit(rule)}
                          onKeyDown={rowKeyDown}
                        >
                          {editLabel}
                        </Button>
                      ) : null}
                      {onDelete ? (
                        <Button
                          variant="outline"
                          size="sm"
                          iconStart={<Icon icon={Trash2} size={14} />}
                          onClick={() => setPendingDelete(rule)}
                          onKeyDown={rowKeyDown}
                        >
                          {deleteLabel}
                        </Button>
                      ) : null}
                    </CardFooter>
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div
        role="group"
        aria-label={testerAriaLabel}
        className="flex flex-col"
        style={{ gap: "var(--space-3)" }}
      >
        {renderTestForm({ input: testInput, onChange: onTestInputChange })}
        <Button
          type="button"
          variant="secondary"
          iconStart={<Icon icon={Play} size={14} mirrorInRtl={false} />}
          onClick={handleRunTest}
          className="self-start"
        >
          {runTestLabel}
        </Button>
        {lastResult !== undefined ? (
          <p role="status" aria-live="polite" className="text-sm text-foreground">
            {lastResult === null
              ? noMatchMessage
              : (renderMatchedRuleSummary ?? getRuleName)(lastResult.rule)}
          </p>
        ) : null}
      </div>

      {onDelete ? (
        <DestructiveConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          title={deleteDialogTitle}
          objectName={pendingDelete ? getRuleName(pendingDelete) : ""}
          descriptionTemplate={deleteDescriptionTemplate}
          actionLabel={deleteLabel}
          onConfirm={() => {
            if (pendingDelete) onDelete(pendingDelete);
            setPendingDelete(null);
          }}
        />
      ) : null}
    </div>
  );
}
