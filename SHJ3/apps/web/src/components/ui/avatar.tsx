"use client";

import * as React from "react";
import { Avatar as AvatarPrimitive } from "radix-ui";
import type { LucideIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";

/**
 * Size is the one axis every variant shares, so it is a `cva` variant rather
 * than a Radix `data-size` attribute selector (the raw shadcn scaffold this
 * replaced used `data-[size=lg]:size-10`-style selectors) — the token gate's
 * arbitrary-value pattern also (correctly, if broadly) catches Tailwind's
 * `data-[…]:` attribute-variant syntax, so this project's components decide
 * variant classes in JS and let `cva` compose them, never in a bracketed CSS
 * selector.
 */
const avatarVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted select-none",
  {
    variants: {
      size: {
        sm: "size-6",
        default: "size-8",
        lg: "size-10",
      },
    },
    defaultVariants: { size: "default" },
  },
);

type AvatarSize = VariantProps<typeof avatarVariants>["size"];

interface AvatarSharedProps {
  size?: AvatarSize;
  className?: string;
  /**
   * True when the person/entity's name is already rendered as adjacent
   * visible text (a table cell, a list row) — design-system.md §5.3 #13. The
   * avatar then becomes purely decorative (`aria-hidden`) instead of
   * announced a second time by a screen reader.
   */
  adjacentNameVisible?: boolean;
}

interface AvatarImageProps extends AvatarSharedProps {
  variant: "image";
  src: string;
  /**
   * The person's real name. Required, not optional — it is this avatar's
   * accessible name (§5.3 #13: "`alt` from the person's real name"), and it
   * doubles as the fallback-initials source while the image loads or on
   * error, so an image avatar can never end up nameless either way.
   */
  name: string;
}

interface AvatarInitialsProps extends AvatarSharedProps {
  variant: "initials";
  name: string;
}

interface AvatarEntityProps extends AvatarSharedProps {
  variant: "entity";
  icon: LucideIcon;
  /** Accessible name for the entity mark, e.g. "SEWA" or "Customs". */
  label: string;
}

export type AvatarProps = AvatarImageProps | AvatarInitialsProps | AvatarEntityProps;

/** First letter of the first and last word; two letters of a single word. */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/**
 * User / entity mark (design-system.md §5.3 #13). One component with a
 * `variant` discriminant rather than the raw scaffold's `Root`/`Image`/
 * `Fallback` compound-parts API, because §5.3's own framing is "variants
 * image / initials / entity", not a composition contract — callers should
 * not have to remember to pair `AvatarImage` with `AvatarFallback` correctly
 * every time.
 *
 * The accessible name lives on the **root** (`role="img"` + `aria-label`),
 * not on the inner `<img>`'s `alt`, so it stays correct regardless of
 * whether the image has loaded, failed, or never had a `src` — Radix's
 * `Image`/`Fallback` swap is a *visual* state machine, and the name must not
 * depend on it. The inner image and the entity `Icon` are therefore always
 * decorative (`alt=""` / no `label`); duplicating the name on both root and
 * child would announce it twice.
 *
 * `"use client"`: `Avatar.Image` genuinely needs it — Radix's image-loading
 * state machine (`imageLoadingStatus`, an internal `useState`/`useEffect`
 * pair, confirmed by reading `@radix-ui/react-avatar`'s source directly) can
 * only run client-side.
 */
export const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { size, className, adjacentNameVisible = false, ...props },
  ref,
) {
  const accessibleName =
    props.variant === "entity"
      ? props.label
      : props.variant === "image" || props.variant === "initials"
        ? props.name
        : "";

  const rootA11yProps = adjacentNameVisible
    ? { "aria-hidden": true as const }
    : { role: "img" as const, "aria-label": accessibleName };

  return (
    <AvatarPrimitive.Root
      ref={ref}
      data-slot="avatar"
      className={cn(avatarVariants({ size }), className)}
      {...rootA11yProps}
    >
      {props.variant === "image" ? (
        <>
          <AvatarPrimitive.Image
            src={props.src}
            alt=""
            className="aspect-square size-full object-cover"
          />
          <AvatarPrimitive.Fallback className="flex size-full items-center justify-center text-xs font-medium text-muted-foreground">
            {getInitials(props.name)}
          </AvatarPrimitive.Fallback>
        </>
      ) : props.variant === "initials" ? (
        <span className="text-xs font-medium text-muted-foreground">{getInitials(props.name)}</span>
      ) : (
        <Icon icon={props.icon} size={16} className="text-muted-foreground" />
      )}
    </AvatarPrimitive.Root>
  );
});
