import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { semanticColors } from "@shj3/tokens";
import { useSkinCandidate } from "./use-skin-candidate.js";

describe("useSkinCandidate — light/dark independent editing (design-system.md §9.2 rule 6)", () => {
  it("editing one mode leaves the other mode's colours completely untouched", () => {
    const { result } = renderHook(() =>
      useSkinCandidate(semanticColors.light, semanticColors.dark),
    );

    act(() => result.current.setToken("light", "primary", "#111111"));

    expect(result.current.light.primary).toBe("#111111");
    // Every other light token is untouched (a whole-object pick would have replaced
    // the light record; a per-key merge, proven here, does not).
    expect(result.current.light.background).toBe(semanticColors.light.background);
    // Dark is a completely separate slice: editing light must not even coincidentally
    // touch it.
    expect(result.current.dark).toEqual(semanticColors.dark);
  });

  it("switching which mode is being edited does not discard the other mode's prior edits", () => {
    const { result } = renderHook(() =>
      useSkinCandidate(semanticColors.light, semanticColors.dark),
    );

    act(() => result.current.setToken("light", "primary", "#LIGHT_EDIT"));
    act(() => result.current.setToken("dark", "primary", "#DARK_EDIT"));

    // Both edits survive simultaneously — editing dark did not revert or discard
    // light's earlier edit, which is exactly rule 6's guarantee.
    expect(result.current.light.primary).toBe("#LIGHT_EDIT");
    expect(result.current.dark.primary).toBe("#DARK_EDIT");
  });

  it("isDirty is false until the first edit, true after", () => {
    const { result } = renderHook(() =>
      useSkinCandidate(semanticColors.light, semanticColors.dark),
    );
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.setToken("light", "primary", "#CHANGED"));
    expect(result.current.isDirty).toBe(true);
  });

  it("discard() reverts BOTH modes to the last clean baseline, by closure — not by refetching (rule 3)", () => {
    const { result } = renderHook(() =>
      useSkinCandidate(semanticColors.light, semanticColors.dark),
    );

    act(() => result.current.setToken("light", "primary", "#LIGHT_EDIT"));
    act(() => result.current.setToken("dark", "primary", "#DARK_EDIT"));
    act(() => result.current.discard());

    expect(result.current.light).toEqual(semanticColors.light);
    expect(result.current.dark).toEqual(semanticColors.dark);
    expect(result.current.isDirty).toBe(false);
  });

  it("markSaved() promotes the current candidate to the new clean baseline — a later discard() reverts to the SAVED values, not the pre-save ones", () => {
    const { result } = renderHook(() =>
      useSkinCandidate(semanticColors.light, semanticColors.dark),
    );

    act(() => result.current.setToken("light", "primary", "#SAVED_VALUE"));
    act(() => result.current.markSaved());
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.setToken("light", "primary", "#UNSAVED_AFTER"));
    expect(result.current.isDirty).toBe(true);

    act(() => result.current.discard());
    expect(result.current.light.primary).toBe("#SAVED_VALUE");
    expect(result.current.isDirty).toBe(false);
  });

  it("replaceMode swaps one mode's entire colour set (e.g. an import) without touching the other mode", () => {
    const { result } = renderHook(() =>
      useSkinCandidate(semanticColors.light, semanticColors.dark),
    );
    const wholeNewLight = {
      ...semanticColors.light,
      primary: "#IMPORTED",
      background: "#IMPORTED_BG",
    };

    act(() => result.current.replaceMode("light", wholeNewLight));

    expect(result.current.light).toEqual(wholeNewLight);
    expect(result.current.dark).toEqual(semanticColors.dark);
    expect(result.current.isDirty).toBe(true);
  });
});
