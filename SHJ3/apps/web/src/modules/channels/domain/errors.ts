/**
 * Domain-level result codes for B10, in this codebase's `<domain>.<reason>` convention
 * (api.md §2.1 / §2.4 — never the vendor's own error text, never a driver exception
 * message). Application-layer use cases return these as plain `{ ok: false; reason }`
 * values for expected business-rule outcomes (mirrors `modules/tools/actions.ts`'s own
 * documented reasoning: an expected refusal is a *result*, not a *fault*, and collapsing
 * it into a generic error string would destroy the information the screen needs to
 * render honestly) — reserving thrown exceptions for genuinely exceptional failures
 * (a lost connection, a corrupt row, a real database CHECK/TRIGGER violation).
 */
export const CHANNELS_REASONS = [
  "channels.agent_required",
  "channels.domain_invalid",
  "channels.template_duplicate_name",
  "channels.template_placeholder_mismatch",
  "channels.template_not_approved",
  "channels.quiet_hours",
  "channels.fallback_locale_required",
  "channels.handover_requires_assistant_available",
  "channels.allowlist_empty_while_live",
  "channels.optin_missing",
  "channels.whatsapp_already_connected",
  "channels.secret_ref_invalid",
] as const;
export type ChannelsReason = (typeof CHANNELS_REASONS)[number];

/**
 * A real, unexpected failure — never used for an expected business-rule refusal. Carries
 * the closed-vocabulary `code` so a caller (a Server Action, the webhook route) can map it
 * to the same wire shape api.md's problem documents use, without inventing a second
 * message convention per module.
 */
export class ChannelsError extends Error {
  constructor(
    readonly code: ChannelsReason,
    message: string,
  ) {
    super(message);
    this.name = "ChannelsError";
  }
}
