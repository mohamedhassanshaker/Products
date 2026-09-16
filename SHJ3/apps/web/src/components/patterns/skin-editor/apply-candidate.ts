/**
 * Live preview via design-system.md §9.2's exact mechanism.
 *
 * Writes candidate tokens as inline custom properties on a scoped root. Inline style
 * beats the server-rendered `<style id="shj3-theme">` block on specificity (both are
 * unlayered declarations at the same selector specificity in the "whole app" case,
 * and an inline `style` attribute always outranks any stylesheet rule regardless of
 * selector in the "preview pane" case), so the candidate wins while it is active and
 * reverts completely on discard, navigation-away or a validation failure — the
 * server-resolved values in `<style id="shj3-theme">` are never mutated by this
 * module, only shadowed for as long as the returned closure has not been called.
 *
 * `scope` is the preview container in "preview" mode and `document.documentElement`
 * in an explicit "preview whole app" toggle mode (§9.1) — this function does not
 * care which; it only ever touches `scope.style`.
 *
 * `toCssCustomPropertyName` is imported from `@shj3/tokens` rather than re-implemented
 * here — the same function `packages/tokens/src/css.ts`'s real emitter and
 * `scripts/gates/no-undefined-token.mjs`'s gate both already use, so this module's
 * notion of "which custom property does this token key become" cannot drift from the
 * one the rest of the system agrees on.
 */

import { toCssCustomPropertyName } from "@shj3/tokens";

/** Reverts every property this call touched to its pre-existing inline value (or
 *  removes the inline declaration entirely if there was none) — never a refetch. */
export type RevertCandidate = () => void;

/**
 * Applies `tokens` (any semantic/component token record — colours, or the scalar
 * geometry/typography values the Layout/Typography sections also preview) to `scope`
 * as inline custom properties, and returns the closure that undoes exactly this call.
 *
 * Calling this again before reverting the first call is safe and expected (switching
 * preview mode, or a control changing while the preview is live): each call snapshots
 * whatever inline value is present *at the moment it runs*, so a chain of
 * apply -> apply -> revert -> revert unwinds in the correct, non-destructive order —
 * the second `apply` snapshots the FIRST apply's inline values, not the original
 * server-resolved ones, which is exactly what makes reverting the second call alone
 * (without reverting the first) leave the first candidate's preview still showing.
 */
export function applyCandidate(
  scope: HTMLElement,
  tokens: Readonly<Record<string, string>>,
): RevertCandidate {
  const previous = new Map<string, string>();
  for (const [key, value] of Object.entries(tokens)) {
    const prop = toCssCustomPropertyName(key);
    previous.set(prop, scope.style.getPropertyValue(prop));
    scope.style.setProperty(prop, value);
  }
  return () => {
    for (const [prop, value] of previous) {
      if (value) scope.style.setProperty(prop, value);
      else scope.style.removeProperty(prop);
    }
  };
}
