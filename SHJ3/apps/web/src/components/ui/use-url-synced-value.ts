"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface UseUrlSyncedValueOptions {
  /**
   * Query-string key to read/write. `null`/`undefined` (and providing
   * `value`, see below) both disable URL sync — the hook then behaves as a
   * plain controlled/uncontrolled value holder with no `next/navigation`
   * calls at all, which is what makes `SubTabBar`/`DateRangeToggle` usable
   * outside a Next.js router context (a non-Next test harness, a future
   * non-Next consumer) when a caller opts out.
   */
  param: string | null | undefined;
  /**
   * Fully controlled value. Providing this takes over completely — the hook
   * echoes it back and forwards changes to `onChange`, and never touches the
   * URL, regardless of `param`.
   *
   * `| undefined` explicitly, not just `?:` — see icon.tsx's identical note:
   * under `exactOptionalPropertyTypes`, a caller forwarding its *own*
   * optional prop's value (e.g. `SubTabBar`'s own `value?: string` prop,
   * destructured and passed straight through here) is passing a
   * `string | undefined`, which `?:` alone does not accept for an explicitly
   * *provided* (vs. omitted) value.
   */
  value?: string | undefined;
  /** Fallback when nothing is controlled and `param` carries nothing (or sync is off). */
  defaultValue?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
}

/**
 * Shared plumbing behind `SubTabBar` and `DateRangeToggle`'s "state lives in
 * the URL" requirement (design-system.md §5.4: both are explicitly specified
 * this way — `SubTabBar` so B13 tab 3 is deep-linkable per Phase F,
 * `DateRangeToggle` "so a range is shareable"). Pulled out once rather than
 * duplicated because `DateRangeToggle` is *specified* as "a `ToggleRow` with
 * URL state" — i.e. the same mechanism, not a parallel one.
 *
 * Uses `next/navigation` rather than the raw History API deliberately: a bare
 * `history.pushState` would desync from the App Router's own client-side
 * navigation cache, which is a real correctness bug in this framework, not a
 * style preference (confirmed against `next/navigation`'s documented
 * contract — `useRouter().replace` is the supported way to change the URL
 * without a full navigation).
 *
 * `router.replace` (never `.push`): switching a tab or a date range is a
 * *view* change, not a new place in history — a `.push` per click would fill
 * the back button with tab flips instead of page navigations, which is a real
 * usability failure the wireframe's own back-button expectations would catch
 * immediately. `{ scroll: false }` for the same reason `next/navigation`
 * documents it: a tab/range switch must not jump the viewport back to the
 * top of a long admin page.
 *
 * ## Why the rendered value is local state, not `searchParams.get(param)` read fresh every render
 *
 * The first version of this hook derived its return value directly from
 * `useSearchParams()` on every render, with no state of its own. That is
 * wrong, found by this molecule's own interaction test rather than shipped:
 * `router.replace()` is asynchronous — `next/navigation`'s own documented
 * contract is that a navigation is scheduled, not applied synchronously — so
 * `useSearchParams()` keeps returning the *pre-click* params for at least one
 * more render after `setValue` runs. A component whose displayed selection
 * depends on that round-trip completing first would visibly fail to respond
 * to the very click that changed it — the exact "half-applied" lag
 * `design-system.md` §7.4 rule 5 rejects for the theme editor, and no less
 * wrong here. The fix is the same shape as every other controlled/
 * uncontrolled molecule in this batch: local state is the render-time source
 * of truth, updated synchronously in `setValue`, and the URL is read only
 * *once* to seed that state's initial value (so a shared link or a reload
 * still lands on the right tab/range) — never re-read reactively after that.
 *
 * **Known, deliberate scope limit:** because of the above, this hook does not
 * live-resync if something *external* changes `param` while mounted (the
 * browser back/forward button, another component editing the same query
 * key). Chasing that would mean disambiguating "the URL changed because of my
 * own last `setValue`" from "the URL changed for an unrelated reason" —
 * real, race-condition-prone complexity — for a behaviour neither
 * `SubTabBar` nor `DateRangeToggle`'s stated contract actually asks for
 * ("deep-linkable", "shareable": a URL restores the state on load, which the
 * one-time seed already satisfies in full). Not built until a real caller
 * needs it.
 */
export function useUrlSyncedValue({
  param,
  value,
  defaultValue,
  onChange,
}: UseUrlSyncedValueOptions): readonly [string | undefined, (next: string) => void] {
  const isControlled = value !== undefined;
  const syncEnabled = param != null && !isControlled;

  // Radix's own router hooks are called unconditionally (React's rules of
  // hooks — `syncEnabled` can differ across renders if a caller changes
  // `param`/`value`, which must not change hook call order). Reading them
  // when sync is disabled is harmless: their return values are simply unused
  // below.
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  // Lazy initializer: runs once, on mount, reading whatever the URL carried
  // at that instant — see the doc comment above for why this is not re-read
  // reactively afterward.
  const [internalValue, setInternalValue] = React.useState<string | undefined>(() => {
    const initialUrlValue = syncEnabled ? (searchParams.get(param) ?? undefined) : undefined;
    return initialUrlValue ?? defaultValue;
  });

  const resolved = isControlled ? value : (internalValue ?? defaultValue);

  const setValue = React.useCallback(
    (next: string) => {
      // Tracking local state and writing the URL are two separate concerns
      // that must not share one guard: an *uncontrolled* instance with URL
      // sync explicitly turned off (`param={null}`) still has to behave like
      // an ordinary uncontrolled component and actually update on
      // interaction — the real bug this comment replaces gated
      // `setInternalValue` behind `syncEnabled` too, so with sync off the
      // component silently stopped responding to input at all, caught by
      // this hook's own test rather than shipped. Controlled instances
      // (`isControlled`) still update neither — the caller owns the value.
      if (!isControlled) {
        setInternalValue(next);
        if (param != null) {
          const params = new URLSearchParams(searchParams.toString());
          params.set(param, next);
          router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        }
      }
      onChange?.(next);
    },
    [isControlled, param, searchParams, pathname, router, onChange],
  );

  return [resolved, setValue] as const;
}
