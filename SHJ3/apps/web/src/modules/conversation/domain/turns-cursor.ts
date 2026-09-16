/**
 * Cursor pagination for `GET /conversations/{id}` (api.md §1.3's convention,
 * applied to one conversation's own turns rather than a tenant-wide list).
 *
 * `ConversationTurns.ordinal` is already a dense, unique-per-conversation,
 * monotonically increasing integer (`UQ_ConversationTurns_conversationId_
 * ordinal`) — exactly the keyset sort column api.md §1.3 asks for, with no
 * second tie-break field needed (unlike the audit log's `(occurredAt, id)`
 * pair) because `ordinal` is already unique on its own within the one
 * conversation this cursor is always scoped to.
 *
 * The cursor is deliberately opaque to a caller (api.md §1.3: "not a document
 * to be parsed, constructed or incremented by a client") even though its
 * payload here is a single integer — decoding is the only supported
 * operation, and a malformed cursor is `pagination.cursor_invalid`, never a
 * silent fallback to the start.
 */

export interface TurnsCursor {
  readonly afterOrdinal: number;
}

export class InvalidCursorError extends Error {
  readonly code = "pagination.cursor_invalid";
  readonly status = 400;

  constructor() {
    super("The supplied cursor is unparseable or foreign to this conversation's turns.");
    this.name = "InvalidCursorError";
  }
}

export function encodeTurnsCursor(cursor: TurnsCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeTurnsCursor(raw: string): TurnsCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCursorError();
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { afterOrdinal?: unknown }).afterOrdinal !== "number" ||
    !Number.isInteger((parsed as { afterOrdinal: number }).afterOrdinal)
  ) {
    throw new InvalidCursorError();
  }
  return { afterOrdinal: (parsed as { afterOrdinal: number }).afterOrdinal };
}

export const DEFAULT_TURNS_PAGE_LIMIT = 50;
export const MAX_TURNS_PAGE_LIMIT = 100;

export function clampLimit(requested: number | null): number {
  if (requested === null || !Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_TURNS_PAGE_LIMIT;
  }
  return Math.min(Math.floor(requested), MAX_TURNS_PAGE_LIMIT);
}
