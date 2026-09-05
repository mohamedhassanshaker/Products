import { Badge } from "@nextbot/ui/components/ui/badge";
import { cn } from "@nextbot/ui/lib/utils";
import { STATUS_DOT_CLASS } from "@nextbot/ui/lib/status-badge";

export type StatusTone = "connected" | "degraded" | "offline" | "neutral";

/**
 * Status dot + text (UX baseline §1.b: "never convey status by color alone").
 * Always pairs a colored dot with a text label — screen readers get the label,
 * sighted users get both signals.
 *
 * Plan Phase 4 rebuild: on shadcn's `Badge` (`variant="outline"`, so the dot itself
 * — not the badge's own text color — is what conveys the status hue; the label
 * text stays the default neutral foreground, always readable regardless of tone).
 * Dot fill colors come from `@nextbot/ui/lib/status-badge`'s `STATUS_DOT_CLASS` —
 * the single source of truth this package's other status-color call sites
 * (`McpHealthDashboard.tsx`, etc.) should migrate onto over time rather than each
 * re-typing an equivalent literal class. Public prop surface (`tone`/`label`) is
 * unchanged from the pre-migration version, so existing call sites need no changes.
 */
export function StatusBadge({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <Badge variant="outline" role="status" className="gap-1.5">
      <span aria-hidden="true" className={cn("size-2 rounded-full", STATUS_DOT_CLASS[tone])} />
      {label}
    </Badge>
  );
}
