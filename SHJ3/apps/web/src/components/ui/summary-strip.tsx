import * as React from "react";
import { cn } from "@/lib/utils";

export type SummaryStripVariant = "rule" | "consequence" | "blocking" | "pointer";

/**
 * One failing condition a `blocking` strip must name in full — RISK-007's
 * fix (design-system.md §11.7): "Arabic readiness" is two independently
 * moving numbers (translation completeness and golden-set accuracy), and a
 * strip that surfaces only the first produces a user who fixes it and is
 * still blocked. All four fields are mandatory so a condition can never be
 * rendered half-explained.
 */
export interface BlockingCondition {
  /** What is blocked, e.g. "Accuracy — Arabic language parity". */
  blocked: string;
  /** The measured value, already formatted by the caller (e.g. "71%") — this component does no Intl formatting of its own (framework-agnostic, matching progress-bar.tsx's precedent). */
  measured: string;
  /** The threshold missed, already formatted (e.g. "85%"). */
  threshold: string;
  /** The screen the figure comes from, e.g. "B13 tab 2". */
  source: string;
}

interface SummaryStripSharedProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** Decorative leading icon (§5.4 anatomy — "optional leading Icon"). */
  icon?: React.ReactNode;
  /**
   * §5.2 "recomputing" state: sets `aria-busy` only — this component never
   * conditionally hides `children`/`conditions` while recomputing, which is
   * the entire mechanism behind §5.4's rule that "previous text is retained
   * rather than blanked." As long as the caller keeps passing the last-known
   * content until the new value resolves, retention happens for free; a
   * Skeleton-style loading swap here would be exactly the wrong move for this
   * component.
   */
  recomputing?: boolean;
  /**
   * §5.2 error state: "the strip could not be computed — say so; never
   * render a stale consequence as if current." When set, this replaces
   * whatever the variant would otherwise render.
   */
  errorMessage?: string;
}

interface RuleOrConsequenceProps extends SummaryStripSharedProps {
  variant?: "rule" | "consequence";
  children: React.ReactNode;
}

interface BlockingProps extends Omit<SummaryStripSharedProps, "children"> {
  variant: "blocking";
  /** The entity the gate is blocking, e.g. "General FAQ Agent v3.0". */
  subject: string;
  /**
   * Non-empty by construction — a TS tuple-rest type (`[T, ...T[]]`), not
   * `T[]`, so `conditions: []` fails to compile rather than needing a
   * runtime length check. This is the mechanical half of RISK-007's fix
   * (§11.7's own published snippet): a `blocking` strip can be constructed
   * with one condition, but never with zero.
   */
  conditions: [BlockingCondition, ...BlockingCondition[]];
  /**
   * Static lead sentence, e.g. "Gate is active." — overridable so a caller
   * can supply a translated string once this screen is wired to next-intl.
   * This component does not import next-intl itself (framework-agnostic,
   * matching progress-bar.tsx's precedent), so the English default lives
   * here as an overridable prop rather than a hardcoded literal (§12.3).
   */
  introText?: string;
  /**
   * Composes "is blocked by N condition(s)." — a *function*, not a string,
   * because real pluralization (ICU MessageFormat) is the caller's job once
   * next-intl is wired here; the default below is the English-only rule
   * with no ICU, matching this file's other framework-agnostic defaults.
   */
  formatBlockedBy?: (count: number) => string;
}

interface PointerProps extends SummaryStripSharedProps {
  variant: "pointer";
  children: React.ReactNode;
  /** Where the linked condition is actually handled, e.g. "/tools/resilience". */
  href: string;
  /** Visible link text, e.g. "Tools → Resilience & fallbacks". */
  linkLabel: string;
}

export type SummaryStripProps = RuleOrConsequenceProps | BlockingProps | PointerProps;

/** LTR-isolated numeric/percentage inline value (§11.3, §11.6 — "Numbers inside remain LTR-isolated: '71%' must not reorder next to Arabic text"). */
function LtrValue({ children }: { children: React.ReactNode }) {
  return (
    <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
      {children}
    </span>
  );
}

/**
 * Known, honest gap, not a silent one: "measured"/"below the"/"threshold."/
 * "Source:" below are hardcoded English connective words mixed with dynamic
 * values — exactly the "sentence by concatenation" shape §11.3 rule 4 warns
 * against, and this file's gate-flagged header sentence (see `introText`/
 * `formatBlockedBy` above) was fixed into overridable props for the same
 * reason. Not fixed identically here: no other component in this batch
 * wires real next-intl yet, and turning every connective word into its own
 * override prop would be premature API surface for zero present consumers.
 * Flagged for whoever wires this screen to next-intl for real, rather than
 * left for a future reader to rediscover.
 */
function BlockingConditionRow({ condition }: { condition: BlockingCondition }) {
  return (
    <li>
      <strong>{condition.blocked}</strong> — measured <LtrValue>{condition.measured}</LtrValue>,
      below the <LtrValue>{condition.threshold}</LtrValue> threshold.{" "}
      <span className="text-muted-foreground">Source: {condition.source}</span>
    </li>
  );
}

interface ShellProps extends React.HTMLAttributes<HTMLDivElement> {
  variant: SummaryStripVariant;
  icon?: React.ReactNode;
  recomputing: boolean;
  children: React.ReactNode;
}

/**
 * Shared chrome (surface, rail, live-region wiring, icon slot) across all
 * four variants. Factored out so the exported component can narrow
 * `SummaryStripProps` per branch with plain destructuring — matching
 * progress-bar.tsx's own established shape for "one component, several
 * structurally different variants" — instead of every branch re-typing the
 * rail/live-region logic.
 *
 * Rail colour is sourced from the real `--summary-strip-border-inline-start`
 * component token (already the full `3px solid var(--border-strong)`
 * shorthand, §4.10) for `rule`/`consequence`/`pointer`. `blocking` needs the
 * *same* 3px width at a *different* colour (`--warning-strong`), and no
 * layer-3 token publishes that pairing — rather than inventing a new
 * component token (out of this batch's scope) or hardcoding a literal `3px`
 * (fails the token gate, and would drift from the real token if it ever
 * changes), the style object sets the shorthand token first and overrides
 * only the colour longhand — exactly the effect of `border-inline-start:
 * var(--summary-strip-border-inline-start); border-inline-start-color:
 * var(--warning-strong);` in a real stylesheet, expressed as ordered object
 * keys, which React applies to `element.style` in that same order.
 */
const SummaryStripShell = React.forwardRef<HTMLDivElement, ShellProps>(function SummaryStripShell(
  { variant, icon, recomputing, className, style, children, ...domProps },
  ref,
) {
  const isLive = variant === "consequence" || variant === "blocking";

  return (
    <div
      ref={ref}
      data-slot="summary-strip"
      data-variant={variant}
      role={isLive ? "status" : undefined}
      aria-live={isLive ? "polite" : undefined}
      aria-busy={recomputing || undefined}
      style={{
        backgroundColor:
          variant === "blocking" ? "var(--warning-subtle)" : "var(--summary-strip-surface)",
        borderInlineStart: "var(--summary-strip-border-inline-start)",
        ...(variant === "blocking" ? { borderInlineStartColor: "var(--warning-strong)" } : {}),
        ...style,
      }}
      className={cn(
        "rounded-md p-4 text-sm leading-relaxed text-foreground",
        recomputing && "opacity-80",
        className,
      )}
      {...domProps}
    >
      <div className="flex items-start gap-2">
        {icon ? (
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground [&>svg]:size-4">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
});

function ErrorMessage({ text }: { text: string }) {
  return <p className="text-destructive-strong">{text}</p>;
}

/**
 * The grey box at the block-end of a pane stating the business rule or live
 * consequence (design-system.md §5.4, full prose) — the wireframe's most
 * distinctive component. `consequence`/`blocking` are computed and reactive:
 * they recompute from whatever state the pane's controls above them write,
 * which is why the shell above never owns a cache of its own — it only ever
 * renders whatever `children`/`conditions` it was just given.
 */
export const SummaryStrip = React.forwardRef<HTMLDivElement, SummaryStripProps>(
  function SummaryStrip(props, ref) {
    const recomputing = props.recomputing ?? false;

    if (props.variant === "blocking") {
      const {
        variant,
        icon,
        recomputing: _r,
        errorMessage,
        subject,
        conditions,
        introText = "Gate is active.",
        formatBlockedBy = (count) =>
          `is blocked by ${count} ${count === 1 ? "condition" : "conditions"}.`,
        ...domProps
      } = props;
      void _r;
      return (
        <SummaryStripShell
          ref={ref}
          variant={variant}
          icon={icon}
          recomputing={recomputing}
          {...domProps}
        >
          {errorMessage ? (
            <ErrorMessage text={errorMessage} />
          ) : (
            <>
              <p>
                {introText} <strong>{subject}</strong> {formatBlockedBy(conditions.length)}
              </p>
              <ul className="mt-1 list-none space-y-1">
                {conditions.map((condition, index) => (
                  // Caller-supplied, order-stable data with no separate id
                  // field (§11.7's own type publishes none) — index is the only
                  // available key, and the list is never independently reordered.
                  <BlockingConditionRow key={index} condition={condition} />
                ))}
              </ul>
            </>
          )}
        </SummaryStripShell>
      );
    }

    if (props.variant === "pointer") {
      const {
        variant,
        icon,
        recomputing: _r,
        errorMessage,
        children,
        href,
        linkLabel,
        ...domProps
      } = props;
      void _r;
      return (
        <SummaryStripShell
          ref={ref}
          variant={variant}
          icon={icon}
          recomputing={recomputing}
          {...domProps}
        >
          {errorMessage ? (
            <ErrorMessage text={errorMessage} />
          ) : (
            <p>
              {children}{" "}
              <a
                href={href}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {linkLabel}
              </a>
            </p>
          )}
        </SummaryStripShell>
      );
    }

    const { variant = "rule", icon, recomputing: _r, errorMessage, children, ...domProps } = props;
    void _r;
    return (
      <SummaryStripShell
        ref={ref}
        variant={variant}
        icon={icon}
        recomputing={recomputing}
        {...domProps}
      >
        {errorMessage ? <ErrorMessage text={errorMessage} /> : <p>{children}</p>}
      </SummaryStripShell>
    );
  },
);
