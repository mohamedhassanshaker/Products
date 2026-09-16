import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges Tailwind class lists safely: `clsx` resolves conditional/array/
 * object class inputs, `twMerge` then drops earlier classes a later one
 * overrides from the same Tailwind property group (e.g. `p-2 p-4` → `p-4`)
 * rather than emitting both and letting CSS source order decide. Standard
 * shadcn/ui helper — every generated component composes its own classes
 * through this (design-system.md §5, components.json `utils` alias).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
