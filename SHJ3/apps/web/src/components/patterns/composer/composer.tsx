"use client";

import * as React from "react";
import { Mic, Paperclip, Send } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Button } from "@/components/ui/button";
// Reuses the atoms wave's shared shimmer keyframe for the recording dot's
// pulse — Tailwind's own `animate-pulse` is a confirmed dead utility in this
// project (the `--animate-*` theme namespace has no bridge; see
// `atom-motion.css`'s own header), and `shj3-animate-shimmer`'s
// opacity-1-to-0.5-and-back keyframe is already exactly a pulse, already
// `prefers-reduced-motion`-safe, and already loaded by every atom that needs
// it — reusing it here is the same "don't reimplement" discipline this batch
// applies to whole components, applied to one keyframe.
import "@/components/ui/atom-motion.css";

/**
 * Structural chrome — a relatively static, per-surface choice (design-system.md
 * §5.5 #49's own "Variants" list). `voice-active` is this file's reading of
 * that list's `voice-active` entry as the mic-forward layout A3 uses (the mic
 * control grows to primary emphasis, the field becomes secondary) — see the
 * component doc comment below for why `paused`, the list's other named
 * "variant", is implemented as a `status` instead.
 */
export type ComposerVariant = "web" | "whatsapp" | "voice-active";

interface ComposerStatusIdle {
  type?: "idle";
}
interface ComposerStatusSending {
  type: "sending";
}
interface ComposerStatusPaused {
  type: "paused";
  /** Visible reason text — §5.5 #49: "disabled with the reason as visible text, not a tooltip." Required, never defaulted: only the caller (which knows *why* — a live agent joined, a channel went offline) can supply honest copy. */
  reason: React.ReactNode;
}
interface ComposerStatusListening {
  type: "listening";
  /** Streaming speech-to-text the caller's own recognition integration is producing. Composer only renders it — see the component doc comment on why no real Web Speech API call lives here. */
  interimTranscript?: string;
}
interface ComposerStatusMicDenied {
  type: "mic-denied";
  /** Re-grant instructions, e.g. "Allow microphone access in your browser's site settings, then try again." Required — an empty alert would fail the spec's own "not a silent dead mic" bar. */
  message: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}
interface ComposerStatusError {
  type: "error";
  message: React.ReactNode;
}

/**
 * Runtime condition — orthogonal to `variant`. A discriminated union, the
 * same shape `StatusCellProps`/`InlineAlertProps`/`EmptyStateProps` already
 * use elsewhere in this library: the active member's own required fields
 * (a `paused` reason, a `mic-denied` re-grant message) can't be omitted by
 * construction, the mechanical enforcement this codebase applies to every
 * "this variant needs this data" rule (§6.1's `Badge.label`, `PermissionMatrix`
 * cell names, etc.).
 */
export type ComposerStatus =
  | ComposerStatusIdle
  | ComposerStatusSending
  | ComposerStatusPaused
  | ComposerStatusListening
  | ComposerStatusMicDenied
  | ComposerStatusError;

export interface ComposerProps {
  variant?: ComposerVariant;
  status?: ComposerStatus;
  value: string;
  onValueChange: (value: string) => void;
  /**
   * The intent to send — Composer never clears `value` itself (it is a
   * controlled component throughout, the same discipline `Checkbox`'s
   * "mirrored into local state" note explicitly reserves for genuinely
   * uncontrolled cases, which this is not): the caller sets `value=""` from
   * its own `onSend` handler once the send has actually been accepted.
   */
  onSend: () => void;
  /**
   * Mic toggle intent. Composer has no real speech-recognition backend of its
   * own (see the component doc comment) — clicking the mic reports the
   * *intent* to start/stop, and the caller drives `status` in response once
   * its own integration actually starts/stops listening.
   */
  onMicToggle?: () => void;
  onAttach?: () => void;
  placeholder?: string;
  /** Accessible name for the field, independent of `placeholder` (design-system.md §10.5: "placeholders are never labels" — a placeholder disappears the moment the user types, and many screen readers never announce it as the accessible name at all). Defaults to `placeholder`'s value, so a caller customising only the placeholder still gets a matching, persistent accessible name. */
  ariaLabel?: string;
  micStartLabel?: string;
  micStopLabel?: string;
  sendLabel?: string;
  attachLabel?: string;
  /** BCP-47 locale — threaded through only for a future translated-default-copy override point; this batch ships English defaults for every string prop above, matching `pagination.tsx`/`empty-state.tsx`'s own "pass a translated string in real feature code" precedent. */
  className?: string;
}

const DEFAULT_PLACEHOLDER = "Ask SHJ3 Assistant";
const DEFAULT_MIC_START_LABEL = "Start voice input";
const DEFAULT_MIC_STOP_LABEL = "Stop voice input";
const DEFAULT_SEND_LABEL = "Send";
const DEFAULT_ATTACH_LABEL = "Attach a file";
const DEFAULT_RETRY_LABEL = "Try again";
const SEND_HINT = "Press Enter to send. Press Shift and Enter together to start a new line.";
const RECORDING_WORD = "Recording";

/**
 * The assistant's input (design-system.md §5.5 #49).
 *
 * ## Why there is no real microphone or speech-recognition code here
 *
 * This wave has no speech-recognition backend to integrate against, and the
 * brief is explicit that wiring one — the real Web Speech API or a vendor
 * SDK — is out of scope here regardless (the same "no vendor imports outside
 * an adapter" rule `architecture.md` applies to backend code applies in
 * spirit to a UI batch with nothing real to adapt to yet). So `status.type
 * === "listening"` and `mic-denied` are rendered exactly as specified —
 * recording dot, the word "Recording", a live interim-transcript region, a
 * real `InlineAlert` re-grant explanation — but every transition between them
 * is the *caller's* responsibility via `onMicToggle` and `status`, not this
 * component pretending to own a microphone it does not have access to.
 *
 * ## Why `paused` is a `status`, not a `variant`, despite §5.5 #49's own list
 *
 * The spec's prose lists `paused` under "Variants" and again, with the actual
 * behavioural detail, under "States." Modelling it as a `variant` alongside
 * `web`/`whatsapp` would force a caller to choose one exclusive chrome *or*
 * pause — but a paused composer is still either a `web` or a `whatsapp`
 * surface underneath (A3's `[rule]` is a live-agent handover, orthogonal to
 * which channel chrome the widget is rendering). `voice-active` is kept as a
 * `variant` because nothing under "States" duplicates it the way "States"'
 * `listening` duplicates "Variants"' `paused` prose — see `ComposerVariant`'s
 * own doc comment.
 *
 * ## `Enter` composition guard
 *
 * `Enter` sends unless `Shift` is held (native newline) or the browser is
 * mid-IME-composition (`nativeEvent.isComposing`) — a real correctness detail
 * for a bilingual EN/AR product: an IME candidate-selection `Enter` must
 * commit the candidate, not submit the message. Arabic input in this project
 * is Latin-keyboard-driven (§11.4's own `[ASSUMPTION]` that every ID/amount/
 * version stays Latin-digit; there is no ICU-style IME step for Arabic script
 * itself), but the guard costs nothing and removes a whole bug class for any
 * future locale that does need one.
 */
export const Composer = React.forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer(
  {
    variant = "web",
    status = { type: "idle" },
    value,
    onValueChange,
    onSend,
    onMicToggle,
    onAttach,
    placeholder = DEFAULT_PLACEHOLDER,
    ariaLabel,
    micStartLabel = DEFAULT_MIC_START_LABEL,
    micStopLabel = DEFAULT_MIC_STOP_LABEL,
    sendLabel = DEFAULT_SEND_LABEL,
    attachLabel = DEFAULT_ATTACH_LABEL,
    className,
  },
  ref,
) {
  const hintId = React.useId();
  const statusMessageId = React.useId();

  const isListening = status.type === "listening";
  const isPaused = status.type === "paused";
  const isSending = status.type === "sending";
  const isMicDenied = status.type === "mic-denied";
  const isError = status.type === "error";
  const hasStatusMessage = isPaused || isMicDenied || isError;

  const fieldDisabled = isPaused || isSending;
  const canSend = value.trim().length > 0 && !fieldDisabled;

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
      event.preventDefault();
      if (canSend) onSend();
    },
    [canSend, onSend],
  );

  const describedBy = hasStatusMessage ? `${hintId} ${statusMessageId}` : hintId;

  // WhatsApp's real composer shares one slot between mic and send — mic while
  // the field is empty, send once there is text to send — rather than showing
  // both persistently the way the web variant's anatomy lists them (design-
  // system.md's own "WhatsApp mic placement" phrase, made concrete here: a
  // judgment call flagged in this wave's report, not asserted as spec text).
  const whatsappShowsSend = variant === "whatsapp" && value.trim().length > 0;
  const showMicButton = variant !== "whatsapp" || !whatsappShowsSend;
  const showSendButton = variant !== "whatsapp" || whatsappShowsSend;

  return (
    <div
      data-slot="composer"
      data-variant={variant}
      data-status={status.type}
      className={className}
    >
      {isPaused ? (
        <InlineAlert variant="info" className="mb-2">
          {status.reason}
        </InlineAlert>
      ) : isMicDenied ? (
        <InlineAlert variant="warning" className="mb-2">
          <span id={statusMessageId}>{status.message}</span>
          {status.onRetry ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={status.onRetry}
              className="ms-1"
            >
              {status.retryLabel ?? DEFAULT_RETRY_LABEL}
            </Button>
          ) : null}
        </InlineAlert>
      ) : isError ? (
        <InlineAlert variant="destructive" className="mb-2">
          <span id={statusMessageId}>{status.message}</span>
        </InlineAlert>
      ) : null}

      <div
        // `border border-border-strong` (Tailwind's own unsuffixed default
        // border-width, the same "no width is spec'd, so don't invent a
        // pixel number" reasoning `card.tsx`'s `selected` rail comment
        // documents) rather than an inline `borderWidth: "1px"` — the latter
        // is a raw length literal the token gate correctly rejects, and
        // Tailwind's default already resolves to exactly 1px with nothing to
        // spell out here.
        className="flex items-end border border-border-strong bg-chat-composer"
        style={{
          borderRadius: variant === "whatsapp" ? "var(--radius-full)" : "var(--input-radius)",
          gap: "var(--space-2)",
          padding: "var(--space-2)",
        }}
      >
        {onAttach ? (
          <IconButton
            type="button"
            variant="ghost"
            ariaLabel={attachLabel}
            disabled={fieldDisabled}
            onClick={onAttach}
          >
            <Icon icon={Paperclip} size={20} />
          </IconButton>
        ) : null}

        {showMicButton ? (
          <IconButton
            type="button"
            variant="ghost"
            ariaLabel={isListening ? micStopLabel : micStartLabel}
            pressed={isListening}
            disabled={isPaused}
            onClick={onMicToggle}
          >
            <Icon icon={Mic} size={20} />
          </IconButton>
        ) : null}

        <div className="min-w-0 flex-1">
          <Textarea
            ref={ref}
            variant="auto-grow"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            aria-label={ariaLabel ?? placeholder}
            aria-describedby={describedBy}
            aria-invalid={isError ? true : undefined}
            disabled={fieldDisabled}
            // Removes only the border/background/shadow the atom renders by
            // default — this field sits nested inside the composer's own
            // bordered `--chat-composer` surface, so its own copy would draw
            // a visible double border. The atom's real `focus-visible` ring
            // (an `outline`, not a `box-shadow`) is left completely alone: it
            // does not depend on `border` to render, and §10.3 is explicit
            // that focus is never removed without a replacement — there is no
            // reason to touch it here at all, let alone remove it with none.
            className="border-none bg-transparent p-0 shadow-none"
            style={{ minHeight: "var(--control-height-md)" }}
          />
          <span id={hintId} className="sr-only">
            {SEND_HINT}
          </span>
        </div>

        {showSendButton ? (
          <IconButton
            type="button"
            variant="primary"
            ariaLabel={sendLabel}
            disabled={!canSend}
            loading={isSending}
            onClick={onSend}
          >
            <Icon icon={Send} size={20} />
          </IconButton>
        ) : null}
      </div>

      {isListening ? (
        // §5.5 #49's anatomy line writes this status line as "Listening —
        // '<transcript>'", but its own a11y paragraph separately *mandates*
        // "a recording dot and the word 'Recording'" — two different words
        // for what reads as the same moment. The a11y paragraph is the
        // binding requirement (§6.1's colour-never-alone rule is what it is
        // enforcing), so "Recording" is the real, always-present word; the
        // dash-and-quoted-transcript *structure* from the anatomy example is
        // kept as the live, `aria-live="polite"` continuation of the same line.
        <div
          className="mt-1 flex items-center text-xs text-muted-foreground"
          style={{ gap: "var(--space-1)" }}
        >
          <span
            aria-hidden="true"
            className="shj3-animate-shimmer size-2 shrink-0 rounded-full bg-destructive"
          />
          <span className="font-medium text-foreground">{RECORDING_WORD}</span>
          {status.interimTranscript ? (
            <span aria-live="polite" className="min-w-0 truncate" dir="auto">
              {" — “"}
              {status.interimTranscript}
              {"”"}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
