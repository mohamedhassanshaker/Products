import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { axe } from "jest-axe";
import { ToastItem, ToastProvider, ToastViewport } from "./toast-item";

/**
 * Same jsdom gap select.test.tsx documents and stubs, plus `matchMedia`
 * (not implemented by jsdom at all — used here to drive the
 * `prefers-reduced-motion` branch under test).
 */
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!("ResizeObserver" in globalThis)) {
    class NoopResizeObserver implements ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = NoopResizeObserver;
  }
});

let reducedMotion = false;

beforeEach(() => {
  reducedMotion = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" ? reducedMotion : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderToast(
  props: React.ComponentProps<typeof ToastItem>,
  onOpenChangeSpy: (open: boolean) => void,
) {
  return render(
    <ToastProvider>
      <ToastItem {...props} onOpenChange={onOpenChangeSpy} />
      <ToastViewport />
    </ToastProvider>,
  );
}

describe("ToastItem", () => {
  it("renders the title and description", () => {
    renderToast(
      { open: true, title: "Re-index started", description: "customs · Fee schedule" },
      vi.fn(),
    );
    expect(screen.getByText("Re-index started")).toBeInTheDocument();
    expect(screen.getByText("customs · Fee schedule")).toBeInTheDocument();
  });

  it("stays visible for at least 6s, then auto-dismisses via onOpenChange(false)", () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    renderToast({ open: true, title: "Promotion approved" }, onOpenChange);

    act(() => {
      vi.advanceTimersByTime(5999);
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("extends the visible duration under prefers-reduced-motion instead of the plain 6s floor", () => {
    reducedMotion = true;
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    renderToast({ open: true, title: "Promotion approved" }, onOpenChange);

    // Would already be closed by now under the non-reduced-motion floor.
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("pauses the close timer while the pointer is over the toast region and resumes after it leaves", () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    renderToast({ open: true, title: "Re-index started" }, onOpenChange);

    const region = screen.getByRole("region");
    fireEvent.pointerMove(region);

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    fireEvent.pointerLeave(region);
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("with-action renders a labelled action that calls onAction", () => {
    const onAction = vi.fn();
    renderToast(
      { open: true, variant: "with-action", title: "Rule disabled", actionLabel: "Undo", onAction },
      vi.fn(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("has zero axe violations for a destructive toast", async () => {
    const { container } = renderToast(
      { open: true, variant: "destructive", title: "Publish failed" },
      vi.fn(),
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
