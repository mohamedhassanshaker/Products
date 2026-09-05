/**
 * jsdom does not implement the `PointerEvent` constructor (only plain `Event`),
 * which every Base UI primitive (`@base-ui/react` — the shadcn preset's chosen
 * primitive library, Plan Phase 0) relies on internally for its own pointer/click
 * handling (`dispatchClickWithModifiers`). Without this shim, `fireEvent.click()`
 * on any Base UI interactive component (Switch, Button, Tooltip trigger, ...)
 * throws `TypeError: ownerWindow(...).PointerEvent is not a constructor` inside
 * `@testing-library/react`, rather than a real assertion failure — a jsdom
 * environment gap, not a bug in the component under test.
 *
 * This file only touches `window`/globals that exist in a jsdom environment; the
 * "unit" vitest project's default environment is `node` (per-file `@vitest-
 * environment jsdom` pragmas opt individual files into jsdom), so this is a no-op
 * for the vast majority of unit tests that never touch the DOM at all.
 */
if (typeof window !== "undefined" && typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    public pointerId: number;
    public width: number;
    public height: number;
    public pressure: number;
    public tangentialPressure: number;
    public tiltX: number;
    public tiltY: number;
    public twist: number;
    public pointerType: string;
    public isPrimary: boolean;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.width = params.width ?? 1;
      this.height = params.height ?? 1;
      this.pressure = params.pressure ?? 0;
      this.tangentialPressure = params.tangentialPressure ?? 0;
      this.tiltX = params.tiltX ?? 0;
      this.tiltY = params.tiltY ?? 0;
      this.twist = params.twist ?? 0;
      this.pointerType = params.pointerType ?? "mouse";
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  // @ts-expect-error — assigning a polyfill onto jsdom's `window`, whose real
  // `PointerEvent` type is intentionally missing in this test environment.
  window.PointerEvent = PointerEventPolyfill;
}
