/**
 * Pure validation for `POST .../turns`'s request body (api.md §4.3).
 *
 * Kept separate from Zod's request-parsing layer (which the route handler
 * owns) because the *content* rules here — the 4,000-character cap, the
 * closed `inputMode` vocabulary — are business rules a unit test should be
 * able to exercise with zero HTTP/Next.js machinery in the loop.
 */

export const MAX_TURN_CONTENT_LENGTH = 4_000;

export const INPUT_MODES = ["text", "chip", "voice", "list_reply"] as const;
export type InputMode = (typeof INPUT_MODES)[number];

export function isInputMode(value: string): value is InputMode {
  return (INPUT_MODES as readonly string[]).includes(value);
}

export interface TurnFieldError {
  readonly pointer: string;
  readonly code: string;
  readonly detail: string;
}

export interface PostTurnInput {
  readonly content: string;
  readonly inputMode: string;
  readonly chipId: string | null;
  readonly clientTurnId: string;
}

/**
 * Exhaustive, not fail-fast (api.md §2.1: "all field errors for a request are
 * returned in one response"). Returns an empty array when the input is valid.
 */
export function validatePostTurnInput(input: {
  readonly content: unknown;
  readonly inputMode: unknown;
  readonly chipId?: unknown;
  readonly clientTurnId: unknown;
}): readonly TurnFieldError[] {
  const errors: TurnFieldError[] = [];

  if (typeof input.content !== "string" || input.content.length === 0) {
    errors.push({
      pointer: "/content",
      code: "field.required",
      detail: "content is required and must be a non-empty string.",
    });
  } else if (input.content.length > MAX_TURN_CONTENT_LENGTH) {
    errors.push({
      pointer: "/content",
      code: "string.max",
      detail: `content must be at most ${MAX_TURN_CONTENT_LENGTH} characters.`,
    });
  }

  if (typeof input.inputMode !== "string" || !isInputMode(input.inputMode)) {
    errors.push({
      pointer: "/inputMode",
      code: "enum.invalid",
      detail: `inputMode must be one of: ${INPUT_MODES.join(", ")}.`,
    });
  }

  if (typeof input.clientTurnId !== "string" || input.clientTurnId.length === 0) {
    errors.push({
      pointer: "/clientTurnId",
      code: "field.required",
      detail: "clientTurnId is required and must be a non-empty string.",
    });
  }

  return errors;
}
