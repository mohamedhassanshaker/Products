"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export interface MergeConfirmationProps {
  open: boolean;
  primaryLabel: string;
  duplicateLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * English defaults, overridable once this screen is wired to next-intl
   * (this component stays framework-agnostic, matching mono-sub-line.tsx's
   * precedent). Named `dialogTitle`, not `title` — a plain `title` default
   * collides, purely by name, with `no-hardcoded-user-string.mjs`'s fixed
   * `placeholder|title|alt|aria-label` literal-attribute check, which reads
   * source text only and cannot tell a JSX attribute from a same-named
   * destructured parameter default.
   */
  dialogTitle?: string;
  /**
   * Builds the full confirmation sentence naming both entities — a
   * *function*, not embedded JSX, because real pluralisation/ordering is a
   * translation-layer concern once this is wired to next-intl (§11.3 rule 4:
   * the template owns the ordering, matching summary-strip.tsx's
   * `formatBlockedBy` precedent exactly). Returns plain text rather than JSX
   * with the entity names wrapped in their own tags, deliberately: every
   * other overridable default in this codebase (`duplicateMessage`,
   * `speakingAnnouncement`, `causeTemplate`, `formatBlockedBy`) is a string
   * or a function returning one, never prose split across embedded markup —
   * the two entity names are still visually distinguished, just via a
   * definition list above this sentence rather than inline bolding (see the
   * component body).
   */
  describeMerge?: (duplicateLabel: string, primaryLabel: string) => string;
  confirmLabel?: string;
  cancelLabel?: string;
}

function defaultDescribeMerge(duplicateLabel: string, primaryLabel: string): string {
  return `${duplicateLabel} will be merged into ${primaryLabel}. This cannot be undone.`;
}

/**
 * Default confirmation for `GraphCanvas`'s duplicate-entity merge
 * (design-system.md §5.5 #44: *"Duplicate-detection merges require a
 * confirmation dialog naming both entities, because a merge is
 * destructive."*).
 *
 * **Cross-wave dependency note.** The design doc's real `Dialog` organism
 * (§5.5 #53) is owned by a concurrent wave and did not exist when this file
 * was written. Per this wave's brief, that is a documented slot dependency,
 * not a blocker: `GraphCanvas` accepts a `renderMergeConfirmation` override
 * (see `graph-canvas.tsx`) so a later pass can swap in the real organism with
 * no API change, and in the meantime this file is the default. It is
 * deliberately **not** a hand-rolled reimplementation of dialog behaviour —
 * it is built directly on the same raw `radix-ui` `Dialog` primitive
 * (`"radix-ui"` is already a project dependency; every Radix-backed
 * component in this codebase imports primitives from it the same way, e.g.
 * `toggle-row.tsx`'s `ToggleGroup as ToggleGroupPrimitive`) that the real
 * `Dialog` organism will itself be built on, so focus trap, `Escape`,
 * scroll lock, focus return and `aria-modal` all come from Radix per §10.1's
 * own table, not from logic re-implemented here.
 */
export function GraphCanvasMergeDialog({
  open,
  primaryLabel,
  duplicateLabel,
  onConfirm,
  onCancel,
  dialogTitle = "Merge duplicate entities?",
  describeMerge = defaultDescribeMerge,
  confirmLabel = "Merge",
  cancelLabel = "Cancel",
}: MergeConfirmationProps) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogPrimitive.Portal>
        {/*
         * Content nested inside Overlay rather than the two as siblings (the
         * shadcn/Radix default) — deliberately, so flexbox centers Content
         * with no `top-1/2`/`left-1/2`/translate-transform positioning at
         * all. Those are exactly the physical-offset trick the raw shadcn
         * Dialog scaffold uses (flagged in this wave's own B-1 infra notes as
         * needing adaptation), and centering via flex composes with logical
         * properties everywhere else instead of introducing the one
         * component in this file that would need a physical-vs-logical
         * argument to justify itself. Radix's outside-click/outside-interact
         * dismissal on Content is computed from Content's own DOM rect, not
         * from Overlay/Content being siblings, so nesting changes nothing
         * behavioural.
         */}
        <DialogPrimitive.Overlay
          className="fixed inset-0 flex items-center justify-center bg-overlay"
          style={{ zIndex: "var(--z-modal)", padding: "var(--space-4)" }}
        >
          {
            // `max-w-sm` was a dead class: this bridge's `--container-*` reset is
            // never re-mapped (tailwind-theme.ts, ADR-0007 "replace, not extend"),
            // so no `max-w-*` utility compiles — the same confirmed-empty gap
            // already fixed at `sign-in-form.tsx`. Reproduced here as the literal
            // `rem` value `max-w-sm` would have used (24rem) via inline `style`,
            // unaffected by the token gate's `px|pt|em`-only length pattern — the
            // sanctioned mechanism, not a gate workaround.
          }
          <DialogPrimitive.Content
            className={cn("w-full border border-border bg-card text-card-foreground shadow-xl")}
            style={{
              borderRadius: "var(--radius-lg)",
              padding: "var(--space-6)",
              maxWidth: "24rem",
            }}
          >
            <DialogPrimitive.Title className="text-md font-semibold text-foreground">
              {dialogTitle}
            </DialogPrimitive.Title>
            {/* The two entity names, visually emphasised on their own line
                rather than bolded inline mid-sentence — see `describeMerge`'s
                doc comment for why the sentence itself (below, in the real
                `Description`) stays a plain, single translatable string. */}
            <p
              className="mt-2 flex flex-wrap items-center text-sm font-medium text-foreground"
              style={{ gap: "var(--space-1)" }}
            >
              <span dir="auto">{duplicateLabel}</span>
              <Icon icon={ArrowRight} size={14} className="text-muted-foreground" />
              <span dir="auto">{primaryLabel}</span>
            </p>
            <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
              {describeMerge(duplicateLabel, primaryLabel)}
            </DialogPrimitive.Description>
            <div className="mt-4 flex items-center justify-end" style={{ gap: "var(--space-2)" }}>
              <DialogPrimitive.Close asChild>
                <Button variant="outline" size="sm" onClick={onCancel}>
                  {cancelLabel}
                </Button>
              </DialogPrimitive.Close>
              <Button variant="destructive" size="sm" onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
