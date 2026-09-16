import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Icon sizes, in CSS pixels (design-system.md §5.3 #14). Passed straight
 * through to the underlying Lucide icon's `size` prop as a bare number —
 * never a `"16px"` string — which `lucide-react` renders as a unitless SVG
 * `width`/`height` attribute. No literal CSS length ever appears in this
 * file's source, so there is nothing here for the token gate to trip on.
 *
 * Deliberately not a design token: `packages/tokens/src/*.ts` has no
 * icon-size scale (grepped "icon" across the whole package — nothing), and
 * glyph sizing is explicitly outside the token catalogue design-system.md
 * §5.3 publishes for this atom. Three of the four (16/20/24) happen to equal
 * `--space-4`/`--space-5`/`--space-6`, but borrowing the spacing scale for an
 * unrelated concern — icon glyph size, not layout spacing — would be the
 * wrong kind of token reuse, and 14 does not correspond to any spacing step
 * at all. So these stay their own small, literal, non-themable scale.
 */
export const ICON_SIZES = [14, 16, 20, 24] as const;
export type IconSize = (typeof ICON_SIZES)[number];

/**
 * Directional icons whose meaning reverses under `dir="rtl"`
 * (design-system.md §11.6): chevrons/arrows along the reading axis,
 * back/forward, indent/outdent, undo/redo, send, and ordered-list direction.
 *
 * Keyed by each icon component's real `displayName` — `lucide-react`'s own
 * `createLucideIcon` sets `Component.displayName = toPascalCase(iconData.name)`
 * for every icon it exports (read directly from the installed
 * `createLucideIcon.mjs`, not assumed), so this is a stable identity to match
 * against rather than a guess from the variable name a caller happened to
 * import it under.
 *
 * An icon absent from this set never mirrors — the deliberately fail-safe
 * default. §11.6 names the failure mode this avoids: "Defaulting to 'mirror
 * everything' is how a mirrored mic icon ships." Extend this set as new
 * directional icons enter the app; it is a living allowlist, not meant to be
 * exhaustive on day one.
 */
export const MIRROR_IN_RTL_ICONS: ReadonlySet<string> = new Set([
  "ChevronLeft",
  "ChevronRight",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeftCircle",
  "ArrowRightCircle",
  "ArrowLeftToLine",
  "ArrowRightToLine",
  "Undo2",
  "Redo2",
  "IndentIncrease",
  "IndentDecrease",
  "Send",
  "ListOrdered",
  "LogOut",
  "LogIn",
  "Reply",
  "Forward",
]);

export interface IconProps extends Omit<
  React.SVGProps<SVGSVGElement>,
  "color" | "fill" | "stroke" | "children" | "aria-hidden" | "aria-label" | "role"
> {
  /** The Lucide icon component to render, e.g. `ChevronRight` from `lucide-react`. */
  icon: LucideIcon;
  size?: IconSize;
  /**
   * Accessible name. Provide it only when this icon is the sole content of
   * its container — no adjacent visible text and no labelled ancestor, e.g. a
   * button that already carries its own `aria-label` (design-system.md
   * §5.3). When provided, the icon renders `role="img"` with this label
   * instead of `aria-hidden`. Omit it whenever adjacent text or a labelled
   * ancestor already names the control, so the name is not announced twice.
   */
  // `| undefined` explicitly, not just `?:` — under this project's
  // `exactOptionalPropertyTypes`, a caller forwarding its *own* optional
  // prop's value (e.g. `Spinner`'s `label` into this one) is passing a
  // `string | undefined`, which `?:` alone does not accept for an explicitly
  // *provided* (vs. omitted) value.
  label?: string | undefined;
  /**
   * Explicit override for whether this instance mirrors under `dir="rtl"`.
   * Most callers should omit this and let `MIRROR_IN_RTL_ICONS` decide from
   * `icon.displayName` — this exists for the rare instance that genuinely
   * disagrees with the icon's usual meaning (§5.3's "a prop the caller sets"
   * option, kept alongside the allowlist rather than instead of it).
   */
  mirrorInRtl?: boolean | undefined;
}

/**
 * Thin, spec-governed wrapper around a `lucide-react` icon (design-system.md
 * §5.3 #14). Every icon in the app goes through this one place for the three
 * rules that are easy to get wrong per call-site:
 *
 *  - Colour is always `currentColor`, so an icon repaints correctly under a
 *    tenant skin. Not just documented — `color`/`fill`/`stroke` are omitted
 *    from `IconProps` entirely, so a hardcoded icon colour cannot compile
 *    through this component at all.
 *  - The accessible-name default is `aria-hidden`, unless the caller states
 *    via `label` that this icon is the sole content of its container.
 *  - RTL mirroring is allowlisted (`MIRROR_IN_RTL_ICONS`), never guessed from
 *    the icon's name or shape.
 *
 * Server-renderable: this file has no hooks and no "use client" of its own.
 * `lucide-react`'s own `Icon.mjs` already carries "use client" internally
 * (verified by reading it directly), which is what actually establishes the
 * client boundary — a Server Component composing this wrapper works exactly
 * like a Server Component composing any other Client Component child.
 */
export const Icon = React.forwardRef<SVGSVGElement, IconProps>(function Icon(
  { icon: IconComponent, size = 16, label, mirrorInRtl, className, ...props },
  ref,
) {
  const iconName = IconComponent.displayName;
  const shouldMirror = mirrorInRtl ?? (iconName !== undefined && MIRROR_IN_RTL_ICONS.has(iconName));

  return (
    <IconComponent
      ref={ref}
      data-slot="icon"
      size={size}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      // `rtl:` is one of Tailwind's built-in direction variants (matches a
      // `[dir="rtl"]` ancestor or self) — not part of any theme namespace, so
      // it survives the `@theme { --color-*: initial; … }` reset that removes
      // Tailwind's default palette (design-system.md §3.4). `-scale-x-100` is
      // Tailwind's own negative-scale utility (`transform: scaleX(-1)`), not
      // an arbitrary value, so it is not a token-gate violation even though
      // mirroring is a per-instance geometric flip rather than a themed value.
      className={cn(shouldMirror && "rtl:-scale-x-100", className)}
      {...props}
    />
  );
});
