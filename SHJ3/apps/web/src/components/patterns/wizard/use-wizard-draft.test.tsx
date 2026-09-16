import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useWizardDraft } from "./use-wizard-draft";

/**
 * Fake timers are scoped to the `describe` blocks that actually drive the 5s
 * debounce — not the whole file. `@testing-library`'s `waitFor` polls with
 * real `setTimeout`/`setInterval` internally, so a global
 * `vi.useFakeTimers()` silently starves every `waitFor` call in the file
 * (confirmed directly: the first draft of this file hung every test after
 * the first `waitFor`, each timing out at its outer 5000ms limit — not
 * assumed from documentation). Tests that need to observe an async
 * transition (`saving`, `restoring`, `error`) use real timers and await the
 * driving promise directly instead.
 */

describe("useWizardDraft", () => {
  describe("the 5s debounce (fake timers)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("does not save until notifyDirty is called", () => {
      const onSaveDraft = vi.fn();
      renderHook(() => useWizardDraft({ activeStepId: "step-1", onSaveDraft }));
      vi.advanceTimersByTime(10_000);
      expect(onSaveDraft).not.toHaveBeenCalled();
    });

    it("saves 5s after the last notifyDirty call (trailing debounce), attributed to the active step", () => {
      const onSaveDraft = vi.fn();
      const { result } = renderHook(() => useWizardDraft({ activeStepId: "step-3", onSaveDraft }));

      act(() => result.current.notifyDirty());
      vi.advanceTimersByTime(4999);
      expect(onSaveDraft).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onSaveDraft).toHaveBeenCalledExactlyOnceWith("step-3");
    });

    it("each notifyDirty call resets the 5s window rather than stacking saves", () => {
      const onSaveDraft = vi.fn();
      const { result } = renderHook(() => useWizardDraft({ activeStepId: "step-1", onSaveDraft }));

      act(() => result.current.notifyDirty());
      vi.advanceTimersByTime(3000);
      act(() => result.current.notifyDirty());
      vi.advanceTimersByTime(3000);
      // 6s of real elapsed time since the first keystroke, but only 3s since
      // the second — the debounce must not have fired yet.
      expect(onSaveDraft).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2000);
      expect(onSaveDraft).toHaveBeenCalledTimes(1);
    });

    it("respects a custom debounceMs", () => {
      const onSaveDraft = vi.fn();
      const { result } = renderHook(() =>
        useWizardDraft({ activeStepId: "step-1", onSaveDraft, debounceMs: 1000 }),
      );
      act(() => result.current.notifyDirty());
      vi.advanceTimersByTime(999);
      expect(onSaveDraft).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onSaveDraft).toHaveBeenCalledTimes(1);
    });

    it("flush() cancels a debounce timer that was already pending", () => {
      const onSaveDraft = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useWizardDraft({ activeStepId: "step-2", onSaveDraft }));

      act(() => result.current.notifyDirty());
      act(() => {
        void result.current.flush();
      });
      expect(onSaveDraft).toHaveBeenCalledTimes(1);

      // The debounce armed by notifyDirty() must have been cancelled by
      // flush() — advancing past where it would have fired must not produce
      // a second call.
      vi.advanceTimersByTime(10_000);
      expect(onSaveDraft).toHaveBeenCalledTimes(1);
    });
  });

  describe("flush()", () => {
    it("saves immediately for the current step", async () => {
      const onSaveDraft = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useWizardDraft({ activeStepId: "step-2", onSaveDraft }));

      act(() => result.current.notifyDirty());
      await act(() => result.current.flush());

      expect(onSaveDraft).toHaveBeenCalledExactlyOnceWith("step-2");
    });

    it("attributes the save to whichever step was active when it is called — the real step-change-save behaviour", async () => {
      const onSaveDraft = vi.fn().mockResolvedValue(undefined);
      const { result, rerender } = renderHook(
        ({ activeStepId }) => useWizardDraft({ activeStepId, onSaveDraft }),
        { initialProps: { activeStepId: "step-1" } },
      );

      act(() => result.current.notifyDirty());
      // Simulate Wizard's own step-change handler: flush *before* the prop
      // that names the new step is applied — the same order a real step
      // change happens in (save the step being left, then move).
      await act(() => result.current.flush());
      rerender({ activeStepId: "step-2" });

      expect(onSaveDraft).toHaveBeenCalledExactlyOnceWith("step-1");
    });
  });

  describe("saving / dirty state", () => {
    it("dirty is true after notifyDirty and false again once a save resolves", async () => {
      const onSaveDraft = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useWizardDraft({ activeStepId: "step-1", onSaveDraft }));

      expect(result.current.dirty).toBe(false);
      act(() => result.current.notifyDirty());
      expect(result.current.dirty).toBe(true);

      await act(() => result.current.flush());
      expect(result.current.dirty).toBe(false);
    });

    it("saving is true only while the save is in flight", async () => {
      let resolveSave: () => void = () => {};
      const onSaveDraft = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveSave = resolve;
          }),
      );
      const { result } = renderHook(() => useWizardDraft({ activeStepId: "step-1", onSaveDraft }));

      act(() => result.current.notifyDirty());

      let flushPromise = Promise.resolve();
      act(() => {
        flushPromise = result.current.flush();
      });
      // `save()` sets `saving` synchronously before its first `await`, so
      // this is already true by the time the `act()` call above returns —
      // no polling required.
      expect(result.current.saving).toBe(true);

      await act(async () => {
        resolveSave();
        await flushPromise;
      });
      expect(result.current.saving).toBe(false);
    });

    it("surfaces a rejected save as error and leaves dirty true", async () => {
      const onSaveDraft = vi.fn().mockRejectedValue(new Error("network down"));
      const { result } = renderHook(() => useWizardDraft({ activeStepId: "step-1", onSaveDraft }));

      act(() => result.current.notifyDirty());
      await act(() => result.current.flush());

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe("network down");
      expect(result.current.dirty).toBe(true);
    });
  });

  describe("loadDraft", () => {
    it("restoring is false immediately when there is no loadDraft at all", () => {
      const { result } = renderHook(() =>
        useWizardDraft({ activeStepId: "step-1", onSaveDraft: vi.fn() }),
      );
      expect(result.current.restoring).toBe(false);
    });

    it("restoring is true until loadDraft resolves", async () => {
      let resolveLoad: () => void = () => {};
      const loadDraft = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveLoad = resolve;
          }),
      );
      const { result } = renderHook(() =>
        useWizardDraft({ activeStepId: "step-1", onSaveDraft: vi.fn(), loadDraft }),
      );
      expect(result.current.restoring).toBe(true);

      // `waitFor` is deliberately not nested inside `act()` here — it already
      // flushes React updates itself as it polls, and testing-library's own
      // guidance is against wrapping it in a second `act()`.
      resolveLoad();
      await waitFor(() => expect(result.current.restoring).toBe(false));
    });
  });

  describe("the unsaved-changes guard", () => {
    it("prevents beforeunload while dirty", () => {
      const onSaveDraft = vi.fn();
      const { result } = renderHook(() => useWizardDraft({ activeStepId: "step-1", onSaveDraft }));
      act(() => result.current.notifyDirty());

      const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
      const preventDefaultSpy = vi.spyOn(event, "preventDefault");
      window.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it("does not intercept beforeunload once the draft is clean", async () => {
      const onSaveDraft = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useWizardDraft({ activeStepId: "step-1", onSaveDraft }));
      act(() => result.current.notifyDirty());
      await act(() => result.current.flush());

      const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
      const preventDefaultSpy = vi.spyOn(event, "preventDefault");
      window.dispatchEvent(event);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });
});
