import * as React from "react";
import { ThumbsDown, ThumbsUp, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";

export type MessageRating = "up" | "down" | null;

interface MessageMetaRowSharedProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  timestamp: Date;
  /** BCP-47 locale for the `Intl.DateTimeFormat` display text — this component does not import next-intl itself (framework-agnostic, matching progress-bar.tsx's precedent); pass the caller's already-resolved `useLocale()` value. */
  locale?: string;
}

interface AssistantProps extends MessageMetaRowSharedProps {
  variant: "assistant";
  onReadAloud: () => void;
  /** True while this message's text-to-speech is actively playing. */
  speaking?: boolean;
  rating: MessageRating;
  onRatingChange: (rating: MessageRating) => void;
  /**
   * Live-region text announced while `speaking` is true, overridable so a
   * caller can supply a translated string once this screen is wired to
   * next-intl — this component does not import next-intl itself
   * (framework-agnostic, matching progress-bar.tsx's precedent), so the
   * English default lives here as an overridable prop rather than a
   * hardcoded literal (§12.3).
   */
  speakingAnnouncement?: string;
}

interface UserProps extends MessageMetaRowSharedProps {
  variant: "user";
}

interface SystemProps extends MessageMetaRowSharedProps {
  variant: "system";
  note: string;
}

export type MessageMetaRowProps = AssistantProps | UserProps | SystemProps;

function formatTimestamp(timestamp: Date, locale: string | undefined): string {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(timestamp);
}

// `locale`/`className` typed `| undefined` explicitly, not just `?:` — under
// this project's `exactOptionalPropertyTypes`, each branch below forwards its
// *own* already-optional prop value (`string | undefined`), not merely an
// omitted key — icon.tsx's identical note.
function Timestamp({
  timestamp,
  locale,
  className,
}: {
  timestamp: Date;
  locale?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <time
      dateTime={timestamp.toISOString()}
      className={cn("text-2xs text-muted-foreground", className)}
    >
      {formatTimestamp(timestamp, locale)}
    </time>
  );
}

/**
 * Per-message speaker/rating/timestamp row for chat (design-system.md §5.4
 * #38, §2.2's *"per-message speaker (TTS), thumbs up, thumbs down,
 * timestamps"*). Three real `IconButton`s, not hand-rolled — that atom
 * already enforces a required `aria-label`, which is exactly the contract
 * this row's three controls need.
 *
 * Rating is two `IconButton`s each carrying its own `aria-pressed`, not a
 * single glyph with a colour swap — functionally a two-state mutually
 * exclusive toggle (§6.4's "position/state as well as colour" rule): a
 * screen reader announces "pressed"/"not pressed" per button regardless of
 * which family colour rendered, and clicking the currently-active one clears
 * the rating rather than being a dead click.
 */
export const MessageMetaRow = React.forwardRef<HTMLDivElement, MessageMetaRowProps>(
  function MessageMetaRow(props, ref) {
    if (props.variant === "system") {
      const { variant, note, timestamp, locale, className, ...domProps } = props;
      void variant;
      return (
        <div
          ref={ref}
          data-slot="message-meta-row"
          data-variant="system"
          role="note"
          className={cn(
            "flex items-center justify-center gap-2 text-2xs text-muted-foreground",
            className,
          )}
          {...domProps}
        >
          <span>{note}</span>
          <Timestamp timestamp={timestamp} locale={locale} />
        </div>
      );
    }

    if (props.variant === "user") {
      const { variant, timestamp, locale, className, ...domProps } = props;
      void variant;
      return (
        <div
          ref={ref}
          data-slot="message-meta-row"
          data-variant="user"
          className={cn("flex items-center justify-end", className)}
          {...domProps}
        >
          <Timestamp timestamp={timestamp} locale={locale} />
        </div>
      );
    }

    const {
      variant,
      timestamp,
      locale,
      onReadAloud,
      speaking = false,
      rating,
      onRatingChange,
      speakingAnnouncement = "Reading message aloud",
      className,
      ...domProps
    } = props;
    void variant;

    function handleRatingClick(next: "up" | "down") {
      onRatingChange(rating === next ? null : next);
    }

    return (
      <div
        ref={ref}
        data-slot="message-meta-row"
        data-variant="assistant"
        data-rated={rating ?? undefined}
        data-speaking={speaking ? "true" : undefined}
        className={cn("flex items-center gap-1", className)}
        {...domProps}
      >
        <IconButton
          ariaLabel={speaking ? "Stop reading aloud" : "Read aloud"}
          variant="ghost"
          size="sm"
          pressed={speaking}
          onClick={onReadAloud}
        >
          <Volume2 aria-hidden="true" className="size-3.5" />
        </IconButton>
        <IconButton
          ariaLabel="Good response"
          variant="ghost"
          size="sm"
          pressed={rating === "up"}
          onClick={() => handleRatingClick("up")}
        >
          <ThumbsUp aria-hidden="true" className="size-3.5" />
        </IconButton>
        <IconButton
          ariaLabel="Poor response"
          variant="ghost"
          size="sm"
          pressed={rating === "down"}
          onClick={() => handleRatingClick("down")}
        >
          <ThumbsDown aria-hidden="true" className="size-3.5" />
        </IconButton>
        {speaking ? (
          <span role="status" aria-live="polite" className="sr-only">
            {speakingAnnouncement}
          </span>
        ) : null}
        <Timestamp timestamp={timestamp} locale={locale} className="ms-1" />
      </div>
    );
  },
);
