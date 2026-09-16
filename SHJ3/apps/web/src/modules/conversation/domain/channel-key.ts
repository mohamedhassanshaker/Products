/**
 * `channelKey` parsing — the public widget/WhatsApp identifier, api.md §4's
 * "no tenant in the request" rule made concrete: the citizen never names a
 * tenant directly, but every anonymous entry point (`widget/bootstrap`,
 * `POST /conversations`, `GET /theme`, `GET /suggestions`) has to resolve one
 * from *something* the caller supplied. That something is `channelKey`,
 * shaped `"{tenantSlug}.{channelKind}"` (e.g. `"sewa.WebWidget"`).
 *
 * ## `channelKey` is not a secret — the origin allow-list is the real boundary
 *
 * A `channelKey` is served back to the browser inside the widget's own HTML
 * (`data-channel-key` on the embed `<script>` tag, readable by anyone who
 * views source on the embedding page) and is never treated as a credential
 * anywhere in this module. The real security boundary for "can this caller
 * open a conversation as this tenant/channel" is `origin-allowlist.ts` — a
 * request presenting a valid-shaped `channelKey` for a real, Live channel is
 * still rejected with `403 widget.domain_not_allowed` unless its `Origin`
 * header is on that channel's own allow-list (api.md §4.1). This is a
 * deliberate, flagged assumption carried over from this module's own brief,
 * not an oversight — do not "fix" this file to make `channelKey` secret; fix
 * the allow-list instead if the threat model ever needs tightening.
 *
 * ## Why parsing lives here, split from tenant/channel *existence*
 *
 * This module only knows how to split and shape-validate the two halves.
 * Whether the named tenant is real, and whether the named channel kind is
 * `Live` for it, are database facts — resolved by the caller (the route
 * handler) via `getTenantDb()` once a tenant context is bound, which requires
 * this function to have already run (the tenant context can't be bound
 * without a tenant to bind). Splitting these two concerns is what keeps this
 * function pure (architecture.md §4: domain/ holds zero I/O) and independently
 * testable against malformed input without a database in the loop at all.
 */

import {
  assertValidSlugShape,
  InvalidTenantSlugError,
  type TenantSlug,
} from "../../platform/tenancy/tenant-slug.js";

/**
 * The two channel kinds a citizen can actually reach through this surface
 * (api.md §0, §4). `MobileApp`/`KioskIvr` share the same `Channels.key`
 * vocabulary (`prisma/tenant/schema.prisma`'s `Channel.key` comment) but are
 * always `Disabled` for this wave — carried here as a closed set rather than
 * accepting any of the four, so a request naming `"sewa.MobileApp"` fails
 * shape validation immediately instead of reaching a database lookup that
 * would reject it anyway for a less specific reason.
 */
export const PUBLIC_CHANNEL_KINDS = ["WebWidget", "WhatsApp"] as const;
export type PublicChannelKind = (typeof PUBLIC_CHANNEL_KINDS)[number];

export function isPublicChannelKind(value: string): value is PublicChannelKind {
  return (PUBLIC_CHANNEL_KINDS as readonly string[]).includes(value);
}

export interface ParsedChannelKey {
  readonly tenant: TenantSlug;
  readonly channelKind: PublicChannelKind;
}

/**
 * Raised for any malformed `channelKey` — wrong segment count, an invalid
 * tenant slug shape, or a channel kind outside `PUBLIC_CHANNEL_KINDS`. Callers
 * translate this to `404` (this surface never distinguishes "malformed" from
 * "well-formed but unknown" in its response — api.md §4.1's "no enumeration"
 * rule applies just as much to a channel as to a conversation).
 */
export class InvalidChannelKeyError extends Error {
  constructor(
    readonly value: string,
    readonly reason: string,
  ) {
    // The raw value is deliberately not interpolated: this is raised on
    // untrusted input and the message reaches logs (mirrors
    // InvalidTenantSlugError's own rule for the identical reason).
    super(`Invalid channelKey: ${reason}`);
    this.name = "InvalidChannelKeyError";
  }
}

/**
 * Split on the **first** `.` only, so a tenant slug can never itself contain a
 * dot (it can't — `SLUG_PATTERN` forbids it — but splitting on the first
 * occurrence rather than the only occurrence is what makes this function's
 * own behaviour independent of that fact, rather than silently depending on
 * a constraint enforced in a different file).
 */
export function parseChannelKey(raw: unknown): ParsedChannelKey {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new InvalidChannelKeyError(String(raw), "must be a non-empty string");
  }

  const separator = raw.indexOf(".");
  if (separator <= 0 || separator === raw.length - 1) {
    throw new InvalidChannelKeyError(
      raw,
      'must be exactly "{tenantSlug}.{channelKind}" — one dot, both halves non-empty',
    );
  }

  const tenantHalf = raw.slice(0, separator);
  const channelHalf = raw.slice(separator + 1);

  // A second dot in the remainder (e.g. "sewa.Web.Widget") means the caller
  // did not send a two-segment key at all — reject rather than silently
  // taking the first two segments and discarding the rest.
  if (channelHalf.includes(".")) {
    throw new InvalidChannelKeyError(raw, "must have exactly two dot-separated segments");
  }

  let tenant: TenantSlug;
  try {
    tenant = assertValidSlugShape(tenantHalf);
  } catch (error) {
    if (error instanceof InvalidTenantSlugError) {
      throw new InvalidChannelKeyError(raw, `tenant segment invalid: ${error.reason}`);
    }
    throw error;
  }

  if (!isPublicChannelKind(channelHalf)) {
    throw new InvalidChannelKeyError(
      raw,
      `channel kind must be one of ${PUBLIC_CHANNEL_KINDS.join(", ")}`,
    );
  }

  return { tenant, channelKind: channelHalf };
}

/** The inverse — building a channelKey for a resolved tenant/kind pair (e.g. for the widget-studio's own embed snippet preview). */
export function formatChannelKey(tenant: TenantSlug, channelKind: PublicChannelKind): string {
  return `${tenant}.${channelKind}`;
}
