"use client";

import * as React from "react";

export interface UseWizardDraftOptions {
  /** The step whose id a debounced or step-change save is attributed to. */
  activeStepId: string;
  /**
   * Persists the draft. This wave has no real draft API to call (B-3, the
   * agent-authoring wave, owns the real endpoint) — `onSaveDraft` is the
   * pluggable seam the brief asks for: called at the right *times*, with no
   * assumption about what it actually persists or how. The caller's own step
   * content (rendered via `Wizard`'s `renderStep`) already holds the live
   * React Hook Form state in its own closure, so a bare step id is enough
   * for the caller to know what to read and save — Wizard never needs to see
   * the form values themselves.
   */
  onSaveDraft: (stepId: string) => void | Promise<void>;
  /** Hydrates the caller's own form state from a previously-saved draft. Called once on mount; omit when there is nothing to restore (e.g. a brand-new agent). */
  loadDraft?: () => void | Promise<void>;
  /** design-system.md §5.5 #42: "written on step change and on a 5s debounce within a step." Overridable for tests. */
  debounceMs?: number;
}

export interface UseWizardDraftResult {
  /** `loadDraft` is still pending — the step pane should show a loading placeholder rather than an empty/default form a save could then clobber. */
  restoring: boolean;
  saving: boolean;
  /** True from the first `notifyDirty()` after a save until the next save resolves. Drives both the footer's autosave status text and the unsaved-changes guard below. */
  dirty: boolean;
  lastSavedAt: number | null;
  error: Error | null;
  /** The caller's step content calls this on every field change (e.g. React Hook Form's `onChange`/`watch`) to (re)start the 5s debounce. */
  notifyDirty: () => void;
  /** Cancels any pending debounce and saves immediately — called on every step change, and by the footer's manual "Save draft" affordance. */
  flush: () => Promise<void>;
}

const DEFAULT_DEBOUNCE_MS = 5000;

/**
 * The persistence *seam* design-system.md §5.5 #42 describes: "a server-side
 * draft record... written on step change and on a 5s debounce within a
 * step," built against `onSaveDraft`/`loadDraft` callbacks rather than a real
 * fetch call to an endpoint that does not exist yet (no draft API exists in
 * this wave — a later wave supplies the real implementation, per the brief).
 * Extracted from `wizard.tsx` into its own hook specifically so the timing —
 * the actual thing this brief asks to be tested, not just "a callback exists"
 * — has a direct, `renderHook` + fake-timers test (`use-wizard-draft.test.ts`)
 * independent of the whole `Wizard` render tree.
 *
 * ## The unsaved-changes guard lives here, not in `wizard.tsx`
 *
 * §5.5 #42's a11y note: "An unsaved-changes guard intercepts navigation
 * away." `dirty` is this hook's own state, so wiring `window.beforeunload`
 * here — rather than making `wizard.tsx` re-derive the same boolean to wire
 * it itself — is the one place that can't drift out of sync with the flag it
 * guards. This intercepts a *browser-level* navigation (tab close, refresh,
 * typed URL) honestly and completely; it cannot intercept an in-app router
 * navigation (e.g. a Next.js `<Link>` to a different screen), because that is
 * a router-level concern this self-contained organism has no access to. The
 * hook's own `dirty` return value is exported precisely so a future page
 * component *can* wire a router guard against it (Next.js's
 * `usePathname`-based navigation-block patterns, or the App Shell wave's own
 * navigation chrome) — tracked here rather than silently left undiscoverable.
 */
export function useWizardDraft({
  activeStepId,
  onSaveDraft,
  loadDraft,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseWizardDraftOptions): UseWizardDraftResult {
  const [restoring, setRestoring] = React.useState(loadDraft !== undefined);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);
  const [error, setError] = React.useState<Error | null>(null);

  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Kept current every render so the debounce timer's closure (created once
  // per `notifyDirty()` call, potentially firing seconds later after several
  // step changes) always saves against whichever step was actually active
  // when it fires, not whichever step was active when the timer was armed.
  const activeStepIdRef = React.useRef(activeStepId);
  activeStepIdRef.current = activeStepId;

  const clearTimer = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const save = React.useCallback(
    async (stepId: string) => {
      clearTimer();
      setSaving(true);
      try {
        await onSaveDraft(stepId);
        setDirty(false);
        setLastSavedAt(Date.now());
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        setSaving(false);
      }
    },
    [clearTimer, onSaveDraft],
  );

  const notifyDirty = React.useCallback(() => {
    setDirty(true);
    clearTimer();
    timerRef.current = setTimeout(() => {
      void save(activeStepIdRef.current);
    }, debounceMs);
  }, [clearTimer, debounceMs, save]);

  const flush = React.useCallback(async () => {
    clearTimer();
    await save(activeStepIdRef.current);
  }, [clearTimer, save]);

  // `loadDraft` runs exactly once, on mount — deliberately outside the
  // dependency array (an `eslint-disable` would be the wrong fix for a
  // caller that passes a fresh arrow function every render, which is the
  // common case): re-running it every time `loadDraft` is a new reference
  // would restore-then-clobber a user's own in-progress edits.
  React.useEffect(() => {
    if (!loadDraft) return;
    let cancelled = false;
    Promise.resolve(loadDraft())
      .then(() => {
        if (!cancelled) setRestoring(false);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught : new Error(String(caught)));
        setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
    // No `react-hooks/exhaustive-deps` rule is configured in this project
    // (checked `eslint.config.mjs` directly rather than assumed), so this
    // empty dependency array needs no suppression comment — it is
    // intentionally mount-only, per the comment above.
  }, []);

  React.useEffect(() => clearTimer, [clearTimer]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!dirty) return;
      event.preventDefault();
      // `returnValue` is the legacy signal browsers still require to show
      // the native confirmation prompt — the string content itself is
      // ignored by every modern browser, only its presence matters.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  return { restoring, saving, dirty, lastSavedAt, error, notifyDirty, flush };
}
