/**
 * The colour half of the SkinEditor's candidate state (design-system.md §9.2).
 *
 * Owns exactly the guarantee rule 6 names: "Light and dark token sets are edited
 * separately and saved together; switching the preview mode does not discard the
 * other mode's edits." `light` and `dark` are independent React state slices — a
 * `setToken("light", ...)` call can never touch `dark`, by construction, not by
 * convention (there is no code path in this file that writes to the mode it was not
 * asked to write to).
 *
 * `discard()` reverts to `baseline`, a `ref` (not state) holding whatever the
 * candidate looked like the last time it was considered "clean" — construction, or
 * the last `markSaved()`. Reverting from a ref rather than re-fetching is rule 3:
 * "Discard reverts by closure, not by re-fetching. Reverting by refetch would leave a
 * window in which the candidate is applied and the server disagrees."
 *
 * Scalar fields (mode, density, direction, font size, shadow depth, sidebar style,
 * app title, skin name/description) are NOT this hook's concern — they are flat,
 * mode-independent values the organism tracks directly, since they need none of the
 * "two independent slices" complexity colours do. `skin-editor.tsx`'s own `isDirty`
 * is this hook's `isDirty` OR'd with whether any scalar field changed.
 */

import { useCallback, useRef, useState } from "react";
import type { SemanticColorTokenName, SemanticColorTokens } from "@shj3/tokens";

export type SkinCandidateMode = "light" | "dark";

export interface UseSkinCandidateResult {
  readonly light: SemanticColorTokens;
  readonly dark: SemanticColorTokens;
  /** True once any colour has diverged from the last clean baseline. */
  readonly isDirty: boolean;
  /** Set one colour token on one mode only. */
  setToken(mode: SkinCandidateMode, key: SemanticColorTokenName, value: string): void;
  /** Replace one mode's entire colour set at once — a "Match brand" bulk action, or a
   *  validated, gap-filled import landing a whole set — still only that one mode. */
  replaceMode(mode: SkinCandidateMode, tokens: SemanticColorTokens): void;
  /** Reverts BOTH modes to the last clean baseline. Never a refetch (rule 3). */
  discard(): void;
  /** The current candidate becomes the new clean baseline (call after a successful
   *  save) — `isDirty` goes false, and a subsequent `discard()` reverts to the
   *  just-saved values, not the pre-save ones. */
  markSaved(): void;
}

export function useSkinCandidate(
  initialLight: SemanticColorTokens,
  initialDark: SemanticColorTokens,
): UseSkinCandidateResult {
  const [light, setLight] = useState(initialLight);
  const [dark, setDark] = useState(initialDark);
  const [isDirty, setIsDirty] = useState(false);
  const baseline = useRef({ light: initialLight, dark: initialDark });

  const setToken = useCallback(
    (mode: SkinCandidateMode, key: SemanticColorTokenName, value: string) => {
      setIsDirty(true);
      if (mode === "light") {
        setLight((prev) => ({ ...prev, [key]: value }));
      } else {
        setDark((prev) => ({ ...prev, [key]: value }));
      }
    },
    [],
  );

  const replaceMode = useCallback((mode: SkinCandidateMode, tokens: SemanticColorTokens) => {
    setIsDirty(true);
    if (mode === "light") setLight(tokens);
    else setDark(tokens);
  }, []);

  const discard = useCallback(() => {
    setLight(baseline.current.light);
    setDark(baseline.current.dark);
    setIsDirty(false);
  }, []);

  const markSaved = useCallback(() => {
    baseline.current = { light, dark };
    setIsDirty(false);
  }, [light, dark]);

  return { light, dark, isDirty, setToken, replaceMode, discard, markSaved };
}
